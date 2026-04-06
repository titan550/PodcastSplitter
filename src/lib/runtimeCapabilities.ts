import type { RuntimeCapabilities } from "../types";

export function detectCapabilities(): RuntimeCapabilities {
  const crossOriginIsolated =
    typeof self !== "undefined" && self.crossOriginIsolated === true;
  const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";

  let webGPU = false;
  try {
    webGPU = "gpu" in navigator;
  } catch { /* unsupported */ }

  const ua =
    typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes("Mac") && typeof document !== "undefined" && "ontouchend" in document);
  const isMobile =
    isIOS || /Android|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua);

  let opfsAvailable = false;
  try {
    opfsAvailable = typeof navigator?.storage?.getDirectory === "function";
  } catch { /* unsupported */ }

  return {
    crossOriginIsolated,
    sharedArrayBuffer,
    webGPU,
    isIOS,
    isMobile,
    opfsAvailable,
  };
}

/**
 * Pick a safe default for parallel ffmpeg encoding. Each instance holds
 * a full copy of the source file, so we want to avoid blowing up memory
 * on mobile or for large files.
 *
 * Rules:
 *   - iOS / mobile → 1 (WebKit memory limits are strict)
 *   - Device memory < 4GB → 1
 *   - Source file > 150MB → 1 (N copies would exceed safe limit)
 *   - Otherwise → 2
 */
export function pickParallelEncoding(
  fileSizeBytes: number,
  caps: RuntimeCapabilities,
): number {
  if (caps.isMobile || caps.isIOS) return 1;

  // navigator.deviceMemory is in GB, approximate, and not available in
  // all browsers. Defaults to 8 (safe high value) if unavailable.
  const deviceMemoryGB =
    (typeof navigator !== "undefined" &&
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory) ||
    8;

  if (deviceMemoryGB < 4) return 1;

  const fileSizeMB = fileSizeBytes / (1024 * 1024);
  if (fileSizeMB > 150) return 1;
  return 2;
}
