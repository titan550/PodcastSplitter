import { useCallback, useEffect, useRef } from "react";
import { useJobReducer } from "./useJobReducer";
import { FilePicker } from "../components/FilePicker";
import { SettingsForm } from "../components/SettingsForm";
import { ProgressPanel } from "../components/ProgressPanel";
import { ErrorBanner } from "../components/ErrorBanner";
import { Footer } from "../components/Footer";
import { Logo } from "../components/Logo";
import { extractMetadata } from "../lib/metadata";
import { zipFilename } from "../lib/filename";
import { saveSettings } from "../lib/jobStore";
import { detectCapabilities, pickParallelEncoding } from "../lib/runtimeCapabilities";
import type { WorkerOutMessage, ProcessingSettings } from "../types";
import type { TTSEngine } from "../lib/tts/TTSEngine";
import "./styles.css";

export function App() {
  const [state, dispatch] = useJobReducer();
  const workerRef = useRef<Worker | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const durationRef = useRef(0);
  const ttsEngineRef = useRef<TTSEngine | null>(null);
  // Promise tracking in-progress TTS init so REQUEST_TTS can await it
  // without re-triggering initialization. Resolves once engine is ready.
  const ttsInitPromiseRef = useRef<Promise<void> | null>(null);
  // Snapshot of job status used by the TTS init progress callback to
  // avoid overwriting the worker's encoding progress with stale model-
  // download updates once the job has started.
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  useEffect(() => {
    saveSettings(state.settings);
  }, [state.settings]);

  // Idempotent TTS init. Returns existing promise if in-flight or complete.
  const initTTS = useCallback((settings: ProcessingSettings): Promise<void> => {
    if (ttsInitPromiseRef.current) return ttsInitPromiseRef.current;
    ttsInitPromiseRef.current = (async () => {
      const { PiperEngine } = await import("../lib/tts/PiperEngine");
      ttsEngineRef.current = new PiperEngine(settings.voiceId);
      await ttsEngineRef.current.init((pct) => {
        // Don't clobber worker progress once the job has started.
        if (statusRef.current === "processing") return;
        dispatch({
          type: "PROGRESS",
          payload: {
            phase: "loading",
            pct,
            overallPct: pct * 0.05,
            detail: `Downloading voice model... ${pct}%`,
          },
        });
      });
    })();
    return ttsInitPromiseRef.current;
  }, []);

  // Preload TTS model on mount so the voice model starts downloading
  // while the user is still picking a file. Silently ignores errors —
  // they surface at processing time if still relevant.
  useEffect(() => {
    if (state.settings.spokenPrefix) {
      initTTS(state.settings).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      // not supported or denied
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }, []);

  // TTS request queue. Worker fires all requests upfront; main thread
  // processes them serially while the worker encodes in parallel.
  //
  // Each entry tags its target worker: after cancel/recreate, in-flight
  // synthesis still completes but the blob is only posted if workerRef
  // still points at that worker, otherwise it would bind to a stale id
  // on the replacement worker (which also starts ids at 0).
  const ttsQueueRef = useRef<
    Array<{ id: number; text: string; targetWorker: Worker }>
  >([]);
  const ttsProcessingRef = useRef(false);

  const terminateAndRecreateWorkerRef = useRef<() => void>(() => {});

  const processTTSQueue = useCallback(async () => {
    if (ttsProcessingRef.current) return;
    ttsProcessingRef.current = true;
    try {
      await ttsInitPromiseRef.current;
      if (!ttsEngineRef.current) throw new Error("TTS not initialized");
      while (ttsQueueRef.current.length > 0) {
        const { id, text, targetWorker } = ttsQueueRef.current.shift()!;
        const wavBlob = await ttsEngineRef.current.synthesizeToWav(text);
        // Only post the result if the worker it was queued for is still
        // the current one. Otherwise the job was cancelled / the worker
        // was recreated, and this blob would bind to an unrelated id.
        if (workerRef.current === targetWorker) {
          targetWorker.postMessage({
            type: "TTS_RESULT",
            payload: { id, wavBlob },
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({
        type: "ERROR",
        payload: { message, phase: "tts", recoverable: false },
      });
      // The worker still has unresolved requestTTS promises awaiting
      // results that will never arrive. Recreate it so the next job
      // starts from a clean slate.
      terminateAndRecreateWorkerRef.current();
      releaseWakeLock();
    } finally {
      ttsProcessingRef.current = false;
    }
  }, [releaseWakeLock]);

  const handleTTSRequest = useCallback(
    (id: number, text: string) => {
      const targetWorker = workerRef.current;
      if (!targetWorker) return;
      ttsQueueRef.current.push({ id, text, targetWorker });
      processTTSQueue();
    },
    [processTTSQueue],
  );

  const createWorker = useCallback(() => {
    const worker = new Worker(
      new URL("../workers/audioWorker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      switch (e.data.type) {
        case "PROGRESS":
          dispatch({ type: "PROGRESS", payload: e.data.payload });
          break;
        case "COMPLETE":
          dispatch({ type: "COMPLETE", zipBlob: e.data.payload.zipBlob });
          releaseWakeLock();
          break;
        case "ERROR":
          dispatch({ type: "ERROR", payload: e.data.payload });
          releaseWakeLock();
          // Worker left in a stale state (e.g. unresolved requestTTS
          // promises). Recreate it so the next job starts clean.
          terminateAndRecreateWorkerRef.current();
          break;
        case "CAPABILITIES":
          dispatch({ type: "CAPABILITIES", payload: e.data.payload });
          break;
        case "REQUEST_TTS":
          handleTTSRequest(e.data.payload.id, e.data.payload.text);
          break;
      }
    };
    worker.onerror = (e) => {
      console.error("Worker error:", e);
      dispatch({
        type: "ERROR",
        payload: {
          message: e.message || "Worker crashed unexpectedly",
          phase: "loading",
          recoverable: false,
        },
      });
      releaseWakeLock();
      terminateAndRecreateWorkerRef.current();
    };
    workerRef.current = worker;
    return worker;
  }, [handleTTSRequest, releaseWakeLock]);

  // Terminates the live worker, drops any TTS queue entries that target
  // it, and spins up a fresh worker.
  const terminateAndRecreateWorker = useCallback(() => {
    const oldWorker = workerRef.current;
    workerRef.current = null;
    try {
      oldWorker?.terminate();
    } catch {
      // terminate can throw if the worker already crashed; ignore
    }
    if (oldWorker) {
      ttsQueueRef.current = ttsQueueRef.current.filter(
        (e) => e.targetWorker !== oldWorker,
      );
    }
    createWorker();
  }, [createWorker]);

  // Keep the ref pointed at the latest helper so processTTSQueue and the
  // worker message handlers (both created before this helper in source
  // order) can call it through the ref without ordering gymnastics.
  useEffect(() => {
    terminateAndRecreateWorkerRef.current = terminateAndRecreateWorker;
  }, [terminateAndRecreateWorker]);

  useEffect(() => {
    createWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [createWorker]);

  const handleFileSelected = useCallback(
    async (file: File) => {
      try {
        const meta = await extractMetadata(file);
        durationRef.current = meta.durationSec;
        dispatch({
          type: "FILE_SELECTED",
          file,
          title: meta.title,
          durationSec: meta.durationSec,
          chapters: meta.chapters,
        });
        // If user has an explicit parallelEncoding that's unsafe for this
        // file, downgrade to the safe max. Auto mode (0) is resolved at
        // job start in handleStart.
        if (state.settings.parallelEncoding > 0) {
          const safeMax = pickParallelEncoding(file.size, detectCapabilities());
          if (state.settings.parallelEncoding > safeMax) {
            dispatch({
              type: "SETTINGS_CHANGED",
              settings: { parallelEncoding: safeMax },
            });
          }
        }
      } catch {
        dispatch({
          type: "ERROR",
          payload: {
            message:
              "Could not read audio metadata. Please check that the file is a valid audio file.",
            phase: "loading",
            recoverable: true,
          },
        });
      }
    },
    [state.settings.parallelEncoding],
  );

  const handleStart = useCallback(() => {
    if (!state.file) return;
    dispatch({ type: "START" });
    requestWakeLock();

    if (state.settings.spokenPrefix) {
      initTTS(state.settings).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        dispatch({
          type: "ERROR",
          payload: { message, phase: "loading", recoverable: false },
        });
        releaseWakeLock();
      });
    }

    // Resolve auto (0) parallelEncoding to a concrete value for this file.
    const resolvedSettings =
      state.settings.parallelEncoding === 0
        ? {
            ...state.settings,
            parallelEncoding: pickParallelEncoding(
              state.file.size,
              detectCapabilities(),
            ),
          }
        : state.settings;

    workerRef.current?.postMessage({
      type: "START_JOB",
      payload: {
        file: state.file,
        settings: resolvedSettings,
        durationSec: durationRef.current,
        splitMode: state.splitMode,
        chapters: state.splitMode === "chapters" ? state.chapters : [],
      },
    });
  }, [
    state.file,
    state.settings,
    state.splitMode,
    state.chapters,
    requestWakeLock,
    releaseWakeLock,
    initTTS,
  ]);

  const handleCancel = useCallback(() => {
    terminateAndRecreateWorker();
    releaseWakeLock();
    dispatch({ type: "RESET" });
  }, [terminateAndRecreateWorker, releaseWakeLock]);

  const handleDownload = useCallback(() => {
    if (!state.zipBlob) return;
    const fname = zipFilename(state.settings.podcastTitle);
    const url = URL.createObjectURL(
      new Blob([state.zipBlob], { type: "application/zip" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 5000);
  }, [state.zipBlob, state.settings.podcastTitle]);

  // Auto-download on completion. Best-effort: Chrome/Firefox usually
  // honor the programmatic click, but Safari and mobile browsers may
  // block it after a long-running job. Manual Download button is the
  // primary fallback path.
  //
  // Ref guard is keyed on the blob identity so a blob-reference update
  // (e.g. re-running a new job with a different blob) re-arms auto-
  // download, while post-complete state changes (title edits, etc.)
  // that keep the same blob can never double-fire the download.
  const autoDownloadedForRef = useRef<Blob | null>(null);
  useEffect(() => {
    if (
      state.status === "complete" &&
      state.zipBlob &&
      autoDownloadedForRef.current !== state.zipBlob
    ) {
      autoDownloadedForRef.current = state.zipBlob;
      handleDownload();
    }
  }, [state.status, state.zipBlob, handleDownload]);

  const isMobile = state.capabilities?.isMobile ?? false;

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <Logo size={36} className="app__logo" />
          <h1>Podcast Splitter</h1>
        </div>
        <p className="app__subtitle">
          Split podcasts into labeled parts for sports headphones
        </p>
      </header>

      {state.error && (
        <ErrorBanner
          error={state.error}
          onDismiss={() => dispatch({ type: "RESET" })}
        />
      )}

      <main className="app__main">
        {state.status === "idle" && (
          <>
            <FilePicker
              isMobile={isMobile}
              onFileSelected={handleFileSelected}
            />
            <div className="app__privacy">
              <p>All audio stays in your browser.</p>
              <p>Spoken prefix generation also runs locally.</p>
            </div>
          </>
        )}

        {state.status === "configuring" && (
          <SettingsForm
            settings={state.settings}
            durationSec={durationRef.current}
            fileSizeMB={state.file ? state.file.size / 1024 / 1024 : 0}
            capabilities={state.capabilities}
            chapters={state.chapters}
            splitMode={state.splitMode}
            onChange={(s) =>
              dispatch({ type: "SETTINGS_CHANGED", settings: s })
            }
            onSplitModeChange={(mode) =>
              dispatch({ type: "SPLIT_MODE_CHANGED", splitMode: mode })
            }
            onStart={handleStart}
          />
        )}

        {state.status === "processing" && (
          <ProgressPanel
            progress={state.progress}
            onCancel={handleCancel}
          />
        )}

        {state.status === "complete" && (
          <div className="complete-panel">
            <h2>Done!</h2>
            <p className="complete-panel__hint">
              Your ZIP should be downloading. If it didn&apos;t start, click below.
            </p>
            <button className="btn btn--primary" onClick={handleDownload}>
              Download ZIP
            </button>
            <button
              className="btn btn--secondary"
              onClick={() => dispatch({ type: "RESET" })}
            >
              Process another file
            </button>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
