import { useCallback, useEffect, useRef, useState } from "react";
import { useJobReducer } from "./useJobReducer";
import { FilePicker } from "../components/FilePicker";
import { SettingsForm } from "../components/SettingsForm";
import { ProgressPanel } from "../components/ProgressPanel";
import { ErrorBanner } from "../components/ErrorBanner";
import { Footer } from "../components/Footer";
import { Logo } from "../components/Logo";
import { extractMetadata, toSourceMetadata } from "../lib/metadata";
import { zipFilename } from "../lib/filename";
import { saveSettings } from "../lib/jobStore";
import { assetUrl } from "../lib/assetUrl";
import { clampPartCount } from "../lib/partCount";
import { errorMessage } from "../lib/errorMessage";
import { detectCapabilities, pickParallelEncoding } from "../lib/runtimeCapabilities";
import { JobController } from "../lib/jobController";
import type { ProcessingSettings } from "../types";
import type { TTSEngine } from "../lib/tts/TTSEngine";
import "./styles.css";

export function App() {
  const [state, dispatch] = useJobReducer();
  const controllerRef = useRef<JobController | null>(null);
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
  // Re-entrancy guard: a double-clicked Start would launch two jobs sharing
  // module-global ffmpeg/zip state.
  const jobActiveRef = useRef(false);

  // Chime audio. Fetched once on mount, then copied (slice(0)) into every
  // START_JOB payload so multiple jobs in the same session still work.
  const beginChimeRef = useRef<ArrayBuffer | null>(null);
  const endChimeRef = useRef<ArrayBuffer | null>(null);
  const [chimesLoaded, setChimesLoaded] = useState(false);
  // Generation counter gates stale chime-fetch results from StrictMode
  // double-mount and overlapping manual retries.
  const loadGenRef = useRef(0);

  // Auto-save settings on change. Skipped while a legacy targetPartDurationSec
  // is pending conversion — otherwise the first pre-file-selection render
  // would overwrite localStorage with the default targetPartCount and we'd
  // lose the user's prior preference on reload.
  useEffect(() => {
    if (state.legacyTargetPartDurationSec != null) return;
    saveSettings(state.settings);
  }, [state.settings, state.legacyTargetPartDurationSec]);

  // Idempotent TTS init. Returns existing promise if in-flight or complete.
  const initTTS = useCallback((settings: ProcessingSettings): Promise<void> => {
    if (ttsInitPromiseRef.current) return ttsInitPromiseRef.current;
    const p = (async () => {
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
    // Drop the memo on failure so a later attempt can retry the download.
    p.catch(() => {
      if (ttsInitPromiseRef.current === p) {
        ttsInitPromiseRef.current = null;
        ttsEngineRef.current = null;
      }
    });
    ttsInitPromiseRef.current = p;
    return p;
  }, [dispatch]);

  // Preload the TTS voice model on mount so it downloads while the user
  // picks a file. Errors surface later at processing time if still relevant.
  useEffect(() => {
    if (state.settings.spokenAnnouncements) {
      initTTS(state.settings).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chimes are mandatory (always played around each part). Fetch once on
  // mount; retry path is exposed through the ErrorBanner for fetch failures.
  const loadChimes = useCallback(async () => {
    const gen = ++loadGenRef.current;
    const load = async (name: string) => {
      const r = await fetch(assetUrl(`chimes/${name}`));
      if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${name}`);
      return r.arrayBuffer();
    };
    try {
      const [b, e] = await Promise.all([load("begin.wav"), load("end.wav")]);
      if (gen !== loadGenRef.current) return;
      beginChimeRef.current = b;
      endChimeRef.current = e;
      setChimesLoaded(true);
      dispatch({ type: "CLEAR_CHIME_ERROR" });
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      dispatch({
        type: "ERROR",
        payload: {
          message: `Failed to load chime audio: ${errorMessage(err)}. Tap retry or reload the page.`,
          phase: "loading",
          recoverable: true,
          source: "chime-load",
        },
      });
    }
  }, [dispatch]);

  useEffect(() => {
    void loadChimes();
  }, [loadChimes]);

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

  // The browser auto-releases the wake lock when the page is hidden;
  // re-acquire on return-to-visible if a job is still running.
  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        statusRef.current === "processing"
      ) {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [requestWakeLock]);

  // Bridge the worker's TTS requests to main-thread Piper synthesis. Reads
  // refs, so it stays stable across renders.
  const synthesize = useCallback(async (text: string): Promise<Blob> => {
    await ttsInitPromiseRef.current;
    if (!ttsEngineRef.current) throw new Error("TTS not initialized");
    return ttsEngineRef.current.synthesizeToWav(text);
  }, []);

  // The JobController owns the audio worker's lifecycle and the TTS relay.
  // Created once on mount; its callbacks dispatch into the reducer and
  // release the wake lock on terminal states.
  useEffect(() => {
    const controller = new JobController({
      onProgress: (payload) => dispatch({ type: "PROGRESS", payload }),
      onComplete: (zipBlob) => {
        dispatch({ type: "COMPLETE", zipBlob });
        releaseWakeLock();
      },
      onError: (payload) => {
        dispatch({ type: "ERROR", payload });
        releaseWakeLock();
      },
      onCapabilities: (payload) => dispatch({ type: "CAPABILITIES", payload }),
      synthesize,
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [dispatch, releaseWakeLock, synthesize]);

  const handleFileSelected = useCallback(
    async (file: File) => {
      try {
        const meta = await extractMetadata(file);
        if (!(meta.durationSec > 0)) {
          // music-metadata may "parse" a corrupt file without throwing,
          // yielding duration 0 — reject early (the catch shows the message).
          throw new Error("audio has no usable duration");
        }
        durationRef.current = meta.durationSec;
        dispatch({
          type: "FILE_SELECTED",
          file,
          title: meta.title,
          durationSec: meta.durationSec,
          chapters: meta.chapters,
          sourceMetadata: toSourceMetadata(meta),
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
    [dispatch, state.settings.parallelEncoding],
  );

  const handleStart = useCallback(() => {
    if (jobActiveRef.current) return; // re-entrancy guard: ignore double-clicks
    if (!state.file || !state.sourceMetadata) return;
    if (!beginChimeRef.current || !endChimeRef.current) return;
    jobActiveRef.current = true;
    dispatch({ type: "START" });
    requestWakeLock();

    if (state.settings.spokenAnnouncements) {
      initTTS(state.settings).catch((err) => {
        dispatch({
          type: "ERROR",
          payload: { message: errorMessage(err), phase: "loading", recoverable: false },
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

    // Clamp at the boundary so a stale targetPartCount in settings (from a
    // playback-speed change that hasn't propagated yet) can't reach the worker.
    const targetPartCount = clampPartCount(
      resolvedSettings.targetPartCount,
      durationRef.current,
      resolvedSettings.playbackSpeed,
    );

    controllerRef.current?.start({
      file: state.file,
      settings: resolvedSettings,
      durationSec: durationRef.current,
      splitMode: state.splitMode,
      chapters: state.splitMode === "chapters" ? state.chapters : [],
      sourceMetadata: state.sourceMetadata,
      // .slice(0) per job so re-running from a fresh Reset still works —
      // ff.writeFile in the worker eventually detaches what it receives.
      beginChime: beginChimeRef.current.slice(0),
      endChime: endChimeRef.current.slice(0),
      targetPartCount,
    });
  }, [
    dispatch,
    state.file,
    state.settings,
    state.splitMode,
    state.chapters,
    state.sourceMetadata,
    requestWakeLock,
    releaseWakeLock,
    initTTS,
  ]);

  // Single teardown path (cancel / dismiss-error / process-another): terminate
  // the worker so an abandoned job can't later auto-download onto a reset UI.
  const handleReset = useCallback(() => {
    jobActiveRef.current = false;
    controllerRef.current?.cancel();
    releaseWakeLock();
    dispatch({ type: "RESET" });
  }, [dispatch, releaseWakeLock]);

  const handleDownload = useCallback(() => {
    if (!state.zipBlob) return;
    const fname = zipFilename(state.settings.podcastTitle);
    // zipBlob is already an application/zip Blob from finalizeZip.
    const url = URL.createObjectURL(state.zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      // .remove() won't throw if the node is already gone, unlike removeChild.
      a.remove();
    }, 5000);
  }, [state.zipBlob, state.settings.podcastTitle]);

  // Auto-download on completion (best-effort — Safari/mobile may block the
  // programmatic click; the manual button is the fallback). Keyed on blob
  // identity so a new job re-arms it, but post-complete state changes that
  // keep the same blob can't double-fire.
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
  const isChimeError = state.error?.source === "chime-load";

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
          onRetry={isChimeError ? () => void loadChimes() : undefined}
          onDismiss={isChimeError ? undefined : handleReset}
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
              <p>Spoken announcements are generated locally too.</p>
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
            chimesReady={chimesLoaded}
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
            onCancel={handleReset}
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
              onClick={handleReset}
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
