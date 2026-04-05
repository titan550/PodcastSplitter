import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { assetUrl } from "./assetUrl";

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
  if (classWorkerURLCached) {
    URL.revokeObjectURL(classWorkerURLCached);
    classWorkerURLCached = null;
  }
}

export interface SkipSilenceOptions {
  minDurationSec: number;
  thresholdDb: number;
}

export interface EncodePartOptions {
  inputFile: string;
  startSec: number;
  endSec: number;
  speed: number;
  bitrate: string;
  outputFile: string;
  skipSilence?: SkipSilenceOptions;
}

export interface EncodePartWithPrefixOptions extends EncodePartOptions {
  prefixFile: string;
}

// Builds a ffmpeg `silenceremove` fragment that strips silences longer
// than minDurationSec below thresholdDb. Empty string when disabled.
// Runs AFTER atempo so the threshold applies to the sped-up signal —
// atempo preserves amplitude, so this is equivalent in practice.
function buildSilenceRemoveStep(skip?: SkipSilenceOptions): string {
  if (!skip) return "";
  return `,silenceremove=stop_periods=-1:stop_duration=${skip.minDurationSec.toFixed(
    2,
  )}:stop_threshold=${skip.thresholdDb}dB`;
}

export async function encodePartWithPrefix(
  ff: FFmpeg,
  opts: EncodePartWithPrefixOptions,
): Promise<void> {
  const { prefixFile, inputFile, startSec, endSec, speed, bitrate, outputFile, skipSilence } =
    opts;
  const duration = endSec - startSec;
  const silenceStep = buildSilenceRemoveStep(skipSilence);
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
      `[1:a]atempo=${speed}${silenceStep},aresample=22050,aformat=sample_fmts=fltp:channel_layouts=mono[seg];` +
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
  opts: EncodePartOptions,
): Promise<void> {
  const { inputFile, startSec, endSec, speed, bitrate, outputFile, skipSilence } = opts;
  const duration = endSec - startSec;
  const silenceStep = buildSilenceRemoveStep(skipSilence);
  await ff.exec([
    "-ss",
    startSec.toFixed(3),
    "-t",
    duration.toFixed(3),
    "-i",
    inputFile,
    "-af",
    `atempo=${speed}${silenceStep}`,
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
