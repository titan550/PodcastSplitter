import { useReducer } from "react";
import type {
  Chapter,
  ProcessingSettings,
  ProgressPayload,
  ErrorPayload,
  RuntimeCapabilities,
  SplitMode,
  SourceMetadata,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { loadLegacyTargetPartDurationSec, loadSettings } from "../lib/jobStore";
import { maxPartCount } from "../lib/partCount";

export type JobStatus =
  | "idle"
  | "configuring"
  | "processing"
  | "complete"
  | "error";

export interface JobState {
  status: JobStatus;
  file: File | null;
  settings: ProcessingSettings;
  progress: ProgressPayload | null;
  zipBlob: Blob | null;
  error: ErrorPayload | null;
  capabilities: RuntimeCapabilities | null;
  // splitMode + chapters are per-file state, NOT settings. They live on
  // JobState (not inside settings) specifically to keep them out of the
  // wholesale localStorage serialization in jobStore.saveSettings.
  splitMode: SplitMode;
  chapters: Chapter[];
  sourceMetadata: SourceMetadata | null;
  // Pre-rename setting value we rescued from localStorage. Converted to
  // targetPartCount once the first file's duration is known (FILE_SELECTED),
  // then cleared. Null for new users and anyone without a legacy value.
  legacyTargetPartDurationSec: number | null;
}

export type JobAction =
  | {
      type: "FILE_SELECTED";
      file: File;
      title: string;
      durationSec: number;
      chapters: Chapter[];
      sourceMetadata: SourceMetadata;
    }
  | { type: "SETTINGS_CHANGED"; settings: Partial<ProcessingSettings> }
  | { type: "SPLIT_MODE_CHANGED"; splitMode: SplitMode }
  | { type: "START" }
  | { type: "PROGRESS"; payload: ProgressPayload }
  | { type: "COMPLETE"; zipBlob: Blob }
  | { type: "ERROR"; payload: ErrorPayload }
  | { type: "CLEAR_CHIME_ERROR" }
  | { type: "RESET" }
  | { type: "CAPABILITIES"; payload: RuntimeCapabilities };

const initialState: JobState = {
  status: "idle",
  file: null,
  settings: DEFAULT_SETTINGS,
  progress: null,
  zipBlob: null,
  error: null,
  capabilities: null,
  splitMode: "time",
  chapters: [],
  sourceMetadata: null,
  legacyTargetPartDurationSec: null,
};

function reducer(state: JobState, action: JobAction): JobState {
  switch (action.type) {
    case "FILE_SELECTED": {
      let settings = { ...state.settings, podcastTitle: action.title };
      let legacyTargetPartDurationSec = state.legacyTargetPartDurationSec;

      // One-shot migration: convert legacy targetPartDurationSec (seconds)
      // to a roughly equivalent targetPartCount now that duration is known.
      if (legacyTargetPartDurationSec != null && action.durationSec > 0) {
        const rawCount = Math.round(
          action.durationSec / settings.playbackSpeed / legacyTargetPartDurationSec,
        );
        const max = maxPartCount(action.durationSec, settings.playbackSpeed);
        settings = {
          ...settings,
          targetPartCount: Math.min(Math.max(1, rawCount), max),
        };
        legacyTargetPartDurationSec = null;
      }

      return {
        ...state,
        status: "configuring",
        file: action.file,
        settings,
        chapters: action.chapters,
        splitMode: action.chapters.length >= 2 ? "chapters" : "time",
        sourceMetadata: action.sourceMetadata,
        error: null,
        legacyTargetPartDurationSec,
      };
    }

    case "SETTINGS_CHANGED":
      return {
        ...state,
        settings: { ...state.settings, ...action.settings },
      };

    case "SPLIT_MODE_CHANGED":
      return {
        ...state,
        splitMode: action.splitMode,
      };

    case "START":
      return {
        ...state,
        status: "processing",
        progress: null,
        error: null,
      };

    case "PROGRESS":
      return {
        ...state,
        progress: action.payload,
      };

    case "COMPLETE":
      return {
        ...state,
        status: "complete",
        progress: null,
        zipBlob: action.zipBlob,
      };

    case "ERROR":
      return {
        ...state,
        status: "error",
        error: action.payload,
        progress: null,
      };

    case "CLEAR_CHIME_ERROR": {
      // Scoped: no-op if the current error isn't a chime-load. Lets the
      // success path of loadChimes unconditionally dispatch without
      // wiping someone else's error.
      if (state.error?.source !== "chime-load") return state;
      if (state.status !== "error") return { ...state, error: null };
      const restored: JobStatus = state.file ? "configuring" : "idle";
      return { ...state, error: null, status: restored };
    }

    case "RESET":
      return {
        ...initialState,
        capabilities: state.capabilities,
        settings: state.settings, // preserve user's saved settings
        legacyTargetPartDurationSec: state.legacyTargetPartDurationSec,
        zipBlob: null,
      };

    case "CAPABILITIES":
      return {
        ...state,
        capabilities: action.payload,
      };
  }
}

// Lazy initializer merges saved settings from localStorage into initial
// state synchronously, so state.settings reflects stored preferences on
// the very first render. This avoids the save-on-change effect clobbering
// saved values with defaults in React StrictMode double-mount.
function init(): JobState {
  const saved = loadSettings();
  const legacy = loadLegacyTargetPartDurationSec();
  return {
    ...initialState,
    settings: { ...DEFAULT_SETTINGS, ...saved },
    legacyTargetPartDurationSec: legacy,
  };
}

export function useJobReducer() {
  return useReducer(reducer, undefined, init);
}
