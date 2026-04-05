import { useReducer } from "react";
import type {
  Chapter,
  ProcessingSettings,
  ProgressPayload,
  ErrorPayload,
  RuntimeCapabilities,
  SplitMode,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { loadSettings } from "../lib/jobStore";

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
  zipUrl: string | null;
  zipBlob: Blob | null;
  error: ErrorPayload | null;
  capabilities: RuntimeCapabilities | null;
  // splitMode + chapters are per-file state, NOT settings. They live on
  // JobState (not inside settings) specifically to keep them out of the
  // wholesale localStorage serialization in jobStore.saveSettings.
  splitMode: SplitMode;
  chapters: Chapter[];
}

export type JobAction =
  | {
      type: "FILE_SELECTED";
      file: File;
      title: string;
      durationSec: number;
      chapters: Chapter[];
    }
  | { type: "SETTINGS_CHANGED"; settings: Partial<ProcessingSettings> }
  | { type: "SPLIT_MODE_CHANGED"; splitMode: SplitMode }
  | { type: "START" }
  | { type: "PROGRESS"; payload: ProgressPayload }
  | { type: "COMPLETE"; zipBlob: Blob }
  | { type: "ERROR"; payload: ErrorPayload }
  | { type: "RESET" }
  | { type: "CAPABILITIES"; payload: RuntimeCapabilities };

const initialState: JobState = {
  status: "idle",
  file: null,
  settings: DEFAULT_SETTINGS,
  progress: null,
  zipUrl: null,
  zipBlob: null,
  error: null,
  capabilities: null,
  splitMode: "time",
  chapters: [],
};

function reducer(state: JobState, action: JobAction): JobState {
  switch (action.type) {
    case "FILE_SELECTED":
      return {
        ...state,
        status: "configuring",
        file: action.file,
        settings: {
          ...state.settings,
          podcastTitle: action.title,
        },
        chapters: action.chapters,
        splitMode: action.chapters.length >= 2 ? "chapters" : "time",
        error: null,
        zipUrl: null,
      };

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
        zipUrl: null,
      };

    case "PROGRESS":
      return {
        ...state,
        progress: action.payload,
      };

    case "COMPLETE": {
      if (state.zipUrl) URL.revokeObjectURL(state.zipUrl);
      return {
        ...state,
        status: "complete",
        progress: null,
        zipUrl: URL.createObjectURL(action.zipBlob),
        zipBlob: action.zipBlob,
      };
    }

    case "ERROR":
      return {
        ...state,
        status: "error",
        error: action.payload,
        progress: null,
      };

    case "RESET":
      if (state.zipUrl) URL.revokeObjectURL(state.zipUrl);
      return {
        ...initialState,
        capabilities: state.capabilities,
        settings: state.settings, // preserve user's saved settings
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
  return {
    ...initialState,
    settings: { ...DEFAULT_SETTINGS, ...saved },
  };
}

export function useJobReducer() {
  return useReducer(reducer, undefined, init);
}
