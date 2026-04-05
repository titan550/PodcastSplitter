// Single source of truth for which audio formats the app accepts.
// Consumed by FilePicker (validation + <input accept>) and audioWorker
// (preserving the source extension so ffmpeg picks the right demuxer).
// Adding a new format here makes it work everywhere.
export const SUPPORTED_AUDIO_EXTS = [
  ".mp3",
  ".m4a",
  ".m4b",
  ".aac",
  ".wav",
  ".ogg",
  ".opus",
  ".flac",
  ".webm",
] as const;

export const ACCEPT_ATTR = [...SUPPORTED_AUDIO_EXTS, "audio/*"].join(",");

/**
 * Returns the extension including the leading dot, preserving case.
 * Empty string when the filename has no extension. Callers that need a
 * case-insensitive comparison (validation, ffmpeg FS naming) should
 * lowercase the result themselves.
 */
export function splitExt(filename: string): string {
  return filename.match(/\.[^.]+$/)?.[0] ?? "";
}

export function isSupportedAudioFile(filename: string): boolean {
  const ext = splitExt(filename).toLowerCase();
  return (SUPPORTED_AUDIO_EXTS as readonly string[]).includes(ext);
}
