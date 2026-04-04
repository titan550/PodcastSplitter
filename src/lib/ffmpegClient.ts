import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

// Pool of ffmpeg instances for parallel encoding. Each instance has
// independent WASM memory and virtual filesystem, so parallelism is real
// but memory-expensive (source file is duplicated per instance).
const ffmpegPool: (FFmpeg | undefined)[] = [];
let classWorkerURLCached: string | null = null;

function canUseMultiThread(preferMultiThread: boolean): boolean {
  return (
    preferMultiThread &&
    typeof SharedArrayBuffer !== "undefined" &&
    self.crossOriginIsolated === true
  );
}

async function createFFmpegInstance(
  preferMultiThread: boolean,
): Promise<FFmpeg> {
  const ff = new FFmpeg();

  // classWorkerURL blob is expensive to create; cache and reuse across
  // instances. Multiple Workers from the same blob URL are independent.
  if (!classWorkerURLCached) {
    classWorkerURLCached = await toBlobURL(
      "/ffmpeg/worker.js",
      "text/javascript",
    );
  }

  const origin = self.location.origin;

  if (canUseMultiThread(preferMultiThread)) {
    const base = `${origin}/ffmpeg/mt`;
    await ff.load({
      classWorkerURL: classWorkerURLCached,
      coreURL: `${base}/ffmpeg-core.js`,
      wasmURL: `${base}/ffmpeg-core.wasm`,
      workerURL: `${base}/ffmpeg-core.worker.js`,
    });
  } else {
    await ff.load({
      classWorkerURL: classWorkerURLCached,
      coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
      wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
    });
  }

  return ff;
}

export async function getFFmpegInstance(
  index: number,
  preferMultiThread: boolean,
): Promise<FFmpeg> {
  const existing = ffmpegPool[index];
  if (existing?.loaded) return existing;
  const ff = await createFFmpegInstance(preferMultiThread);
  ffmpegPool[index] = ff;
  return ff;
}

export function getFFmpeg(preferMultiThread: boolean): Promise<FFmpeg> {
  return getFFmpegInstance(0, preferMultiThread);
}

/**
 * Load `count` ffmpeg instances in parallel. Returns them in order.
 * Instance 0 may already be loaded from earlier (silence detection).
 */
export async function getFFmpegPool(
  count: number,
  preferMultiThread: boolean,
): Promise<FFmpeg[]> {
  const promises: Promise<FFmpeg>[] = [];
  for (let i = 0; i < count; i++) {
    promises.push(getFFmpegInstance(i, preferMultiThread));
  }
  return Promise.all(promises);
}

export function terminateFFmpeg(): void {
  for (const ff of ffmpegPool) {
    try {
      ff?.terminate();
    } catch {
      // ignore per-instance terminate errors so remaining instances
      // still get cleaned up
    }
  }
  ffmpegPool.length = 0;
  if (classWorkerURLCached) {
    URL.revokeObjectURL(classWorkerURLCached);
    classWorkerURLCached = null;
  }
}

export async function encodePartWithPrefix(
  ff: FFmpeg,
  prefixFile: string,
  inputFile: string,
  startSec: number,
  endSec: number,
  speed: number,
  bitrate: string,
  outputFile: string,
): Promise<void> {
  const duration = endSec - startSec;
  await ff.exec([
    "-i",
    prefixFile,
    "-ss",
    startSec.toFixed(3),
    "-t",
    duration.toFixed(3),
    "-i",
    inputFile,
    "-filter_complex",
    `[0:a]aresample=22050,aformat=sample_fmts=fltp:channel_layouts=mono,apad=pad_dur=0.5[pfx];` +
      `[1:a]atempo=${speed},aresample=22050,aformat=sample_fmts=fltp:channel_layouts=mono[seg];` +
      `[pfx][seg]concat=n=2:v=0:a=1[out]`,
    "-map",
    "[out]",
    "-c:a",
    "libmp3lame",
    "-b:a",
    bitrate,
    outputFile,
  ]);
}

export async function encodePartNoPrefix(
  ff: FFmpeg,
  inputFile: string,
  startSec: number,
  endSec: number,
  speed: number,
  bitrate: string,
  outputFile: string,
): Promise<void> {
  const duration = endSec - startSec;
  await ff.exec([
    "-ss",
    startSec.toFixed(3),
    "-t",
    duration.toFixed(3),
    "-i",
    inputFile,
    "-af",
    `atempo=${speed}`,
    "-ar",
    "22050",
    "-ac",
    "1",
    "-c:a",
    "libmp3lame",
    "-b:a",
    bitrate,
    outputFile,
  ]);
}

export async function cleanupFiles(
  ff: FFmpeg,
  ...filenames: string[]
): Promise<void> {
  await Promise.all(
    filenames.map(async (f) => {
      try {
        await ff.deleteFile(f);
      } catch {
        // ignore missing files
      }
    }),
  );
}
