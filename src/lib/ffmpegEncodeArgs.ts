import type { Tag } from "../types";

export interface SkipSilenceOptions {
  minDurationSec: number;
  thresholdDb: number;
}

export interface EncodeArgsInput {
  inputFile: string;
  prefixFile: string | undefined;
  coverFile: string | undefined;
  startSec: number;
  endSec: number;
  speed: number;
  bitrate: string;
  outputFile: string;
  skipSilence: SkipSilenceOptions | undefined;
  sourceSampleRate: number | undefined;
  sourceChannels: number | undefined;
  audioProfile: "source" | "voice";
  tags: Tag[];
}

// libmp3lame only accepts these sample rates.
const MP3_RATES = [
  8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
] as const;

/**
 * Floor to the nearest MP3-supported sample rate. Never upsamples (would
 * inflate filesize with no fidelity gain). Minimum is 8000 (libmp3lame
 * rejects anything below).
 */
export function clampToMp3Rate(rate: number): number {
  return Math.max(
    8000,
    MP3_RATES.reduce(
      (best, r) => (r <= rate && r > best ? r : best),
      0,
    ),
  );
}

/**
 * Resolve the target sample rate + channel layout based on the audio
 * profile and source stream properties.
 */
export function resolveTargetFormat(
  audioProfile: "source" | "voice",
  srcRate: number | undefined,
  srcChannels: number | undefined,
): { rate: number; layout: "mono" | "stereo" } {
  if (audioProfile === "voice") return { rate: 22050, layout: "mono" };
  const rate = clampToMp3Rate(srcRate ?? 44100);
  const layout = (srcChannels ?? 2) >= 2 ? "stereo" : "mono";
  return { rate, layout };
}

function buildSilenceRemoveStep(skip: SkipSilenceOptions | undefined): string {
  if (!skip) return "";
  return `,silenceremove=stop_periods=-1:stop_duration=${skip.minDurationSec.toFixed(2)}:stop_threshold=${skip.thresholdDb}dB`;
}

/** Build the full ffmpeg arg array for encoding one part. */
export function buildEncodeArgs(input: EncodeArgsInput): string[] {
  const {
    inputFile,
    prefixFile,
    coverFile,
    startSec,
    endSec,
    speed,
    bitrate,
    outputFile,
    skipSilence,
    sourceSampleRate,
    sourceChannels,
    audioProfile,
    tags,
  } = input;

  const duration = endSec - startSec;
  const { rate, layout } = resolveTargetFormat(
    audioProfile,
    sourceSampleRate,
    sourceChannels,
  );
  const channelCount = layout === "mono" ? 1 : 2;
  const silenceStep = buildSilenceRemoveStep(skipSilence);
  const aformat = `aresample=${rate},aformat=sample_fmts=fltp:channel_layouts=${layout}`;

  const args: string[] = [];

  // --- Inputs ---
  // Input ordering: [prefix?], source (with seek), [cover?]
  // Track each input's index for -map/-filter_complex references.
  let srcIndex: number;

  if (prefixFile) {
    args.push("-i", prefixFile);
    srcIndex = 1;
  } else {
    srcIndex = 0;
  }

  args.push("-ss", startSec.toFixed(3), "-t", duration.toFixed(3));
  args.push("-i", inputFile);

  let coverIndex: number | undefined;
  if (coverFile) {
    coverIndex = prefixFile ? 2 : 1;
    args.push("-i", coverFile);
  }

  // --- Filter / audio processing ---
  if (prefixFile) {
    // Both streams go through explicit aresample + aformat so concat
    // sees declared-matching params. The prefix upsamples from 22050
    // mono to target; the source normalizes (usually a no-op).
    const filterComplex =
      `[0:a]${aformat},apad=pad_dur=0.5[pfx];` +
      `[${srcIndex}:a]atempo=${speed}${silenceStep},${aformat}[seg];` +
      `[pfx][seg]concat=n=2:v=0:a=1[out]`;
    args.push("-filter_complex", filterComplex);
    args.push("-map", "[out]");
  } else {
    args.push(
      "-af",
      `atempo=${speed}${silenceStep},aformat=sample_fmts=fltp`,
    );
    args.push("-map", "0:a");
    args.push("-ar", String(rate), "-ac", String(channelCount));
  }

  // --- Cover art mapping ---
  if (coverIndex !== undefined) {
    args.push(
      "-map", `${coverIndex}:v`,
      "-c:v", "copy",
      "-disposition:v:0", "attached_pic",
    );
  }

  // --- Codec + bitrate ---
  args.push("-c:a", "libmp3lame", "-b:a", bitrate);

  // --- ID3v2 version (required for APIC compatibility) ---
  if (coverIndex !== undefined) {
    args.push("-id3v2_version", "3");
  }

  // --- Metadata tags ---
  for (const t of tags) {
    args.push("-metadata", `${t.key}=${t.value}`);
  }

  // --- Output ---
  args.push(outputFile);

  return args;
}
