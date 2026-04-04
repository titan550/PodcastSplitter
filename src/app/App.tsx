import { useCallback, useEffect, useRef } from "react";
import { useJobReducer } from "./useJobReducer";
import { FilePicker } from "../components/FilePicker";
import { SettingsForm } from "../components/SettingsForm";
import { ProgressPanel } from "../components/ProgressPanel";
import { ErrorBanner } from "../components/ErrorBanner";
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

  // TTS request queue — worker fires all requests upfront, main thread
  // processes them serially (single TTS session) while worker encodes in
  // parallel. This pipelines TTS synthesis with ffmpeg encoding.
  const ttsQueueRef = useRef<Array<{ id: number; text: string }>>([]);
  const ttsProcessingRef = useRef(false);

  const processTTSQueue = useCallback(async () => {
    if (ttsProcessingRef.current) return;
    ttsProcessingRef.current = true;
    try {
      await ttsInitPromiseRef.current;
      if (!ttsEngineRef.current) throw new Error("TTS not initialized");
      while (ttsQueueRef.current.length > 0) {
        const { id, text } = ttsQueueRef.current.shift()!;
        const wavBlob = await ttsEngineRef.current.synthesizeToWav(text);
        workerRef.current?.postMessage({
          type: "TTS_RESULT",
          payload: { id, wavBlob },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({
        type: "ERROR",
        payload: { message, phase: "tts", recoverable: false },
      });
      ttsQueueRef.current.length = 0;
    } finally {
      ttsProcessingRef.current = false;
    }
  }, []);

  const handleTTSRequest = useCallback(
    (id: number, text: string) => {
      ttsQueueRef.current.push({ id, text });
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
    };
    workerRef.current = worker;
    return worker;
  }, [handleTTSRequest]);

  useEffect(() => {
    createWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [createWorker]);

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
            message: "Could not read MP3 metadata. Is this a valid MP3 file?",
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
      },
    });
  }, [state.file, state.settings, requestWakeLock, releaseWakeLock, initTTS]);

  const handleCancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    releaseWakeLock();
    dispatch({ type: "RESET" });
    createWorker();
  }, [createWorker, releaseWakeLock]);

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

  const isMobile = state.capabilities?.isMobile ?? false;

  return (
    <div className="app">
      <header className="app__header">
        <h1>Podcast Splitter</h1>
        <p className="app__subtitle">
          Split podcasts into labeled parts for swimming headphones
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
              <p>All podcast audio stays in your browser.</p>
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
            onChange={(s) =>
              dispatch({ type: "SETTINGS_CHANGED", settings: s })
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
    </div>
  );
}
