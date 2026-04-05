// --- Processing settings ---

export interface ProcessingSettings {
  targetPartDurationSec: number;
  podcastTitle: string;
  playbackSpeed: number;
  spokenPrefix: boolean;
  outputBitrate: string;
  voiceId: string;
  silenceThresholdDb: number;
  silenceMinDurationSec: number;
  // Number of parallel ffmpeg instances for encoding parts.
  // 0 = auto (picked based on file size + device capabilities at job start)
  // 1-4 = explicit user choice
  // Each instance holds a full copy of the source file in WASM heap,
  // so N=2 means ~2× source size in memory.
  parallelEncoding: number;
  // Strip silences longer than skipLongSilenceMinSec from each encoded part.
  skipLongSilences: boolean;
  skipLongSilenceMinSec: number;
}

export const DEFAULT_SETTINGS: ProcessingSettings = {
  targetPartDurationSec: 300,
  podcastTitle: "",
  playbackSpeed: 1.25,
  spokenPrefix: true,
  outputBitrate: "128k",
  voiceId: "en_US-amy-low",
  silenceThresholdDb: -30,
  silenceMinDurationSec: 0.5,
  parallelEncoding: 0, // auto
  skipLongSilences: false,
  skipLongSilenceMinSec: 3,
};

// --- Metadata ---

export interface Chapter {
  title: string;
  start: number; // seconds from start of file
}

export interface PodcastMetadata {
  title: string;
  durationSec: number;
  bitrate: number | undefined;
  sampleRate: number | undefined;
  fileSizeBytes: number;
  chapters: Chapter[];
}

export type SplitMode = "time" | "chapters";

// --- Cut planning ---

export interface SilenceInterval {
  start: number;
  end: number;
}

export interface CutPoint {
  startSec: number;
  endSec: number;
  partIndex: number;
  // Populated only in chapter-mode plans; undefined for time-based cuts.
  // Carried on the cut so the worker doesn't have to re-match chapters
  // to cuts after planning.
  chapterTitle?: string;
}

// --- Worker messages ---

export type WorkerInMessage =
  | {
      type: "START_JOB";
      payload: {
        file: File;
        settings: ProcessingSettings;
        durationSec: number;
        splitMode: SplitMode;
        chapters: Chapter[]; // empty when splitMode === "time"
      };
    }
  | {
      type: "TTS_RESULT";
      payload: { id: number; wavBlob: Blob };
    };

export type Phase =
  | "loading"
  | "analyzing"
  | "planning"
  | "tts"
  | "encoding"
  | "zipping";

export interface ProgressPayload {
  phase: Phase;
  partsCompleted?: number;
  totalParts?: number;
  pct: number;
  overallPct: number;
  detail?: string;
}

export interface ErrorPayload {
  message: string;
  phase: string;
  recoverable: boolean;
}

export type WorkerOutMessage =
  | { type: "PROGRESS"; payload: ProgressPayload }
  | { type: "COMPLETE"; payload: { zipBlob: Blob } }
  | { type: "ERROR"; payload: ErrorPayload }
  | { type: "CAPABILITIES"; payload: RuntimeCapabilities }
  | { type: "REQUEST_TTS"; payload: { id: number; text: string } };

// --- Runtime capabilities ---

export interface RuntimeCapabilities {
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  webGPU: boolean;
  isIOS: boolean;
  isMobile: boolean;
  opfsAvailable: boolean;
}
