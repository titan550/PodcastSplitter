import type { FFmpeg } from "@ffmpeg/ffmpeg";
import type { SilenceInterval } from "../types";

const START_RE = /silence_start:\s*([\d.]+)/;
const END_RE = /silence_end:\s*([\d.]+)/;

export function parseSilenceLog(lines: string[]): SilenceInterval[] {
  const silences: SilenceInterval[] = [];
  let pendingStart: number | null = null;

  for (const line of lines) {
    const startMatch = line.match(START_RE);
    if (startMatch) {
      pendingStart = parseFloat(startMatch[1]!);
      continue;
    }
    const endMatch = line.match(END_RE);
    if (endMatch && pendingStart !== null) {
      silences.push({ start: pendingStart, end: parseFloat(endMatch[1]!) });
      pendingStart = null;
    }
  }

  return silences;
}

export async function detectSilences(
  ffmpeg: FFmpeg,
  inputFilename: string,
  thresholdDb: number,
  minDurationSec: number,
): Promise<SilenceInterval[]> {
  const logLines: string[] = [];

  const logHandler = ({ message }: { message: string }) => {
    logLines.push(message);
  };

  ffmpeg.on("log", logHandler);

  try {
    // Downsample to 8kHz mono before silencedetect for significant speedup.
    // silencedetect only needs amplitude data, not audio quality.
    await ffmpeg.exec([
      "-i",
      inputFilename,
      "-af",
      `aresample=8000,aformat=channel_layouts=mono,silencedetect=noise=${thresholdDb}dB:d=${minDurationSec}`,
      "-f",
      "null",
      "-",
    ]);
  } finally {
    ffmpeg.off("log", logHandler);
  }

  return parseSilenceLog(logLines);
}
