import type { Tag } from "../types";

export interface SkipSilenceOptions {
  minDurationSec: number;
  thresholdDb: number;
}

export interface EncodeArgsInput {
  inputFile: string;
  // Optional TTS-generated WAVs framing the source. Both are present when
  // spokenAnnouncements is on and TTS succeeded; otherwise both are
  // undefined. Treated as a matched pair by the filter graph.
  prefixFile: string | undefined;
  suffixFile: string | undefined;
  // Always present. Framing chimes that bookend each part (and each
  // message, when announcements are on) — see buildEncodeArgs for layout.
  beginChimeFile: string;
  endChimeFile: string;
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

/**
 * Silence-removal filter. Runs *before* atempo so `stop_duration` is
 * measured in source-time seconds (matches user intuition: "cut silences
 * longer than 3 s" means 3 s in the original recording). `stop_silence`
 * keeps a small buffer on each side of a cut so the transition doesn't
 * sound abrupt even when the threshold classifies a borderline word as
 * silence.
 *
 * Returns the bare filter token (no leading comma). Callers insert the
 * separator when composing the source leg of the filter graph. Cut-point
 * snapping uses the permissive `silenceThresholdDb` setting; this filter
 * uses the stricter `silenceRemovalThresholdDb` so false positives don't
 * delete quiet speech.
 */
function buildSilenceRemoveStep(skip: SkipSilenceOptions | undefined): string {
  if (!skip) return "";
  return `silenceremove=stop_periods=-1:stop_duration=${skip.minDurationSec.toFixed(2)}:stop_threshold=${skip.thresholdDb}dB:stop_silence=0.5`;
}

/**
 * Build the full ffmpeg arg array for encoding one part.
 *
 * Input layout (numeric indices tracked as we push):
 *   0  beginChimeFile  (always)
 *   .  prefixFile      (start TTS, optional)
 *   .  inputFile       (source, with -ss/-t seek)
 *   .  suffixFile      (end TTS, optional)
 *   .  endChimeFile    (always)
 *   .  coverFile       (optional)
 *
 * Filter graph (announcements on, 4-chime pattern):
 *   [begin] [prefix] [begin] [seg] [end] [suffix] [end] → concat n=7
 * The begin/end chime inputs are each split into two outputs via
 * `asplit=2` so they can appear twice without re-reading the file.
 *
 * Filter graph (announcements off, 2-chime pattern):
 *   [begin] [seg] [end] → concat n=3
 */
export function buildEncodeArgs(input: EncodeArgsInput): string[] {
  const {
    inputFile,
    prefixFile,
    suffixFile,
    beginChimeFile,
    endChimeFile,
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
  const silenceCore = buildSilenceRemoveStep(skipSilence);
  const silencePrefix = silenceCore ? `${silenceCore},` : "";
  const aformat = `aresample=${rate},aformat=sample_fmts=fltp:channel_layouts=${layout}`;

  const args: string[] = [];

  // --- Inputs (indices assigned as we push) ---
  let nextInputIdx = 0;

  args.push("-i", beginChimeFile);
  const beginIndex = nextInputIdx++;

  let pfxIndex: number | undefined;
  if (prefixFile) {
    args.push("-i", prefixFile);
    pfxIndex = nextInputIdx++;
  }

  args.push("-ss", startSec.toFixed(3), "-t", duration.toFixed(3));
  args.push("-i", inputFile);
  const srcIndex = nextInputIdx++;

  let sfxIndex: number | undefined;
  if (suffixFile) {
    args.push("-i", suffixFile);
    sfxIndex = nextInputIdx++;
  }

  args.push("-i", endChimeFile);
  const endIndex = nextInputIdx++;

  let coverIndex: number | undefined;
  if (coverFile) {
    args.push("-i", coverFile);
    coverIndex = nextInputIdx++;
  }

  // --- Filter complex ---
  // asplit=2 reuses a single input stream twice without a second decode.
  const concatParts: string[] = [];
  let filterChain = "";

  if (pfxIndex !== undefined && sfxIndex !== undefined) {
    filterChain += `[${beginIndex}:a]${aformat},asplit=2[b1][b2];`;
    filterChain += `[${pfxIndex}:a]${aformat},apad=pad_dur=0.3[pfx];`;
    filterChain += `[${srcIndex}:a]${silencePrefix}atempo=${speed},${aformat}[seg];`;
    filterChain += `[${sfxIndex}:a]${aformat},apad=pad_dur=0.3[sfx];`;
    filterChain += `[${endIndex}:a]${aformat},asplit=2[e1][e2];`;
    concatParts.push("[b1]", "[pfx]", "[b2]", "[seg]", "[e1]", "[sfx]", "[e2]");
  } else {
    filterChain += `[${beginIndex}:a]${aformat}[b];`;
    filterChain += `[${srcIndex}:a]${silencePrefix}atempo=${speed},${aformat}[seg];`;
    filterChain += `[${endIndex}:a]${aformat}[e];`;
    concatParts.push("[b]", "[seg]", "[e]");
  }
  const n = concatParts.length;
  const filterComplex = `${filterChain}${concatParts.join("")}concat=n=${n}:v=0:a=1[out]`;

  args.push("-filter_complex", filterComplex);
  args.push("-map", "[out]");

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
