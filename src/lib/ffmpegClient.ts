import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { assetUrl } from "./assetUrl";
import { buildEncodeArgs, type EncodeArgsInput } from "./ffmpegEncodeArgs";

// Pool of ffmpeg instances for parallel encoding. Each instance has
// independent WASM memory and virtual filesystem, so parallelism is real
// but memory-expensive (source file is duplicated per instance). This is
// the ONLY parallelism strategy the app uses — we intentionally do not
// ship @ffmpeg/core-mt (pthread-enabled single-instance parallelism):
// per-part parallelism across multiple instances is more effective for
// this workload and avoids the iOS Safari pthread quirks.
const ffmpegPool: (FFmpeg | undefined)[] = [];
let classWorkerURLCached: string | null = null;

async function createFFmpegInstance(): Promise<FFmpeg> {
  const ff = new FFmpeg();

  // classWorkerURL blob is expensive to create; cache and reuse across
  // instances. Multiple Workers from the same blob URL are independent.
  if (!classWorkerURLCached) {
    classWorkerURLCached = await toBlobURL(
      assetUrl("/ffmpeg/worker.js"),
      "text/javascript",
    );
  }

  await ff.load({
    classWorkerURL: classWorkerURLCached,
    coreURL: assetUrl("/ffmpeg/ffmpeg-core.js"),
    wasmURL: assetUrl("/ffmpeg/ffmpeg-core.wasm"),
  });

  return ff;
}

export async function getFFmpegInstance(index: number): Promise<FFmpeg> {
  const existing = ffmpegPool[index];
  if (existing?.loaded) return existing;
  const ff = await createFFmpegInstance();
  ffmpegPool[index] = ff;
  return ff;
}

export function getFFmpeg(): Promise<FFmpeg> {
  return getFFmpegInstance(0);
}

/**
 * Load `count` ffmpeg instances in parallel. Returns them in order.
 * Instance 0 may already be loaded from earlier (silence detection).
 */
export async function getFFmpegPool(count: number): Promise<FFmpeg[]> {
  const promises: Promise<FFmpeg>[] = [];
  for (let i = 0; i < count; i++) {
    promises.push(getFFmpegInstance(i));
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
  // Don't revoke classWorkerURLCached — it's reused across jobs and freed when
  // the worker terminates.
}

/**
 * Encode one part. All arg construction is delegated to `buildEncodeArgs`.
 */
export async function encodePart(
  ff: FFmpeg,
  opts: EncodeArgsInput,
): Promise<void> {
  // ff.exec returns ffmpeg's exit code and does NOT reject on failure — throw
  // so a failed encode doesn't ship an empty MP3 as success.
  const code = await ff.exec(buildEncodeArgs(opts));
  if (code !== 0) {
    throw new Error(
      `ffmpeg encode failed (exit code ${code}) for ${opts.outputFile}`,
    );
  }
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
