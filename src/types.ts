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
  // "source" preserves source sample rate + channel layout (default).
  // "voice" forces 22.05 kHz mono for sports-headphone use.
  audioProfile: "source" | "voice";
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
  audioProfile: "source",
};

// --- Metadata ---

export interface Chapter {
  title: string;
  start: number; // seconds from start of file
}

export interface CoverArt {
  data: Uint8Array;
  mimeType: "image/jpeg";
}

export interface PodcastMetadata {
  title: string;
  durationSec: number;
  fileSizeBytes: number;
  chapters: Chapter[];
  // Stream properties
  sampleRate: number | undefined;
  numberOfChannels: number | undefined;
  bitrate: number | undefined;
  // Tag passthrough
  artist: string | undefined;
  albumartist: string | undefined;
  album: string | undefined;
  date: string | undefined;
  genre: string | undefined;
  comment: string | undefined;
  composer: string | undefined;
  publisher: string | undefined;
  copyright: string | undefined;
  language: string | undefined;
  coverArt: CoverArt | undefined;
}

// Per-file source metadata passed through START_JOB to the worker.
// Derived from PodcastMetadata minus the UI-only fields. Transient —
// never persisted via jobStore.
export type SourceMetadata = Omit<
  PodcastMetadata,
  "title" | "durationSec" | "fileSizeBytes" | "chapters" | "bitrate"
>;

export interface Tag {
  key: string;
  value: string;
}

export type SplitMode = "time" | "chapters";

// --- Cut planning ---

export interface SilenceInterval {
  start: number;
  end: number;
}

export interface ChapterCutInfo {
  title: string;
  number: number;
  totalChapters: number;
  // Present only when the chapter was long enough to be subdivided.
  part?: { index: number; count: number };
}

export interface CutPoint {
  startSec: number;
  endSec: number;
  partIndex: number;
  // Absent for time-mode cuts. When present, all chapter-mode consumers
  // (speech text, filename, UI) read chapter identity from here — no
  // per-field presence checks required.
  chapter?: ChapterCutInfo;
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
        sourceMetadata: SourceMetadata;
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
