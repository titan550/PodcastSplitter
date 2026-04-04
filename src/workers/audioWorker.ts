import type {
  WorkerInMessage,
  WorkerOutMessage,
  ProcessingSettings,
  Phase,
} from "../types";
import { detectCapabilities } from "../lib/runtimeCapabilities";
import {
  getFFmpeg,
  getFFmpegPool,
  terminateFFmpeg,
  encodePartWithPrefix,
  encodePartNoPrefix,
  cleanupFiles,
} from "../lib/ffmpegClient";
import { detectSilences } from "../lib/silenceDetection";
import { planCuts } from "../lib/cutPlanner";
import { buildSpeechText } from "../lib/tts/speechText";
import { partFilename } from "../lib/filename";
import { createZipWriter, addPartToZip, finalizeZip } from "../lib/exportZip";

const INPUT_FILE = "input.mp3";

let currentPhase: Phase = "loading";

// Kick off ffmpeg loading as soon as the worker module is evaluated, so
// WASM fetching overlaps with the main thread's TTS model download and
// user's file selection. getFFmpeg is idempotent — subsequent calls
// return the same loaded instance.
void getFFmpeg(false).catch(() => {
  // Errors surface later when runPipeline awaits getFFmpeg again
});

// TTS relay: worker sends multiple concurrent requests identified by id.
// Main thread processes them serially and pushes results back as each
// completes, enabling pipelining between TTS synthesis and ffmpeg encoding.
let nextTTSId = 0;
const pendingTTS = new Map<number, (blob: Blob) => void>();

function requestTTS(text: string): Promise<Blob> {
  const id = nextTTSId++;
  return new Promise((resolve) => {
    pendingTTS.set(id, resolve);
    post({ type: "REQUEST_TTS", payload: { id, text } });
  });
}

function post(msg: WorkerOutMessage): void {
  self.postMessage(msg);
}

function progress(
  phase: Phase,
  pct: number,
  totalParts: number,
  partsCompleted?: number,
  detail?: string,
): void {
  currentPhase = phase;
  post({
    type: "PROGRESS",
    payload: {
      phase,
      partsCompleted,
      totalParts,
      pct,
      overallPct: computeOverallPct(
        phase,
        pct,
        partsCompleted ?? 0,
        totalParts,
      ),
      detail,
    },
  });
}

function computeOverallPct(
  phase: Phase,
  phasePct: number,
  partsCompleted: number,
  totalParts: number,
): number {
  const LOAD = 5;
  const ANALYZE = 10;
  const PARTS = 80;
  const ZIP = 5;

  switch (phase) {
    case "loading":
      return (phasePct / 100) * LOAD;
    case "analyzing":
    case "planning":
      return LOAD + (phasePct / 100) * ANALYZE;
    case "tts":
    case "encoding": {
      // partsCompleted is monotonic; smoothly fills the 80% PARTS slice
      const partFrac = totalParts > 0 ? partsCompleted / totalParts : 0;
      return LOAD + ANALYZE + partFrac * PARTS;
    }
    case "zipping":
      return LOAD + ANALYZE + PARTS + (phasePct / 100) * ZIP;
  }
}

async function runPipeline(
  file: File,
  settings: ProcessingSettings,
  totalDuration: number,
): Promise<void> {
  if (totalDuration <= 0) {
    throw new Error("Could not determine audio duration");
  }

  const parallelism = settings.parallelEncoding;

  progress("loading", 0, 0, undefined, "Loading audio engine...");
  const ff0 = await getFFmpeg(settings.preferMultiThread);
  progress("loading", 100, 0, undefined, "Audio engine ready");

  progress("analyzing", 0, 0, undefined, "Reading audio file...");
  // Retain the raw ArrayBuffer for slice() copies into any additional
  // pool instances; ffmpeg.writeFile transfers (detaches) whatever we
  // hand it, so the primary write must also use a fresh copy.
  let sourceBuffer: ArrayBuffer | null = await file.arrayBuffer();
  await ff0.writeFile(INPUT_FILE, new Uint8Array(sourceBuffer.slice(0)));

  progress("analyzing", 30, 0, undefined, "Detecting silences...");
  const silences = await detectSilences(
    ff0,
    INPUT_FILE,
    settings.silenceThresholdDb,
    settings.silenceMinDurationSec,
  );
  progress(
    "analyzing",
    100,
    0,
    undefined,
    `Found ${silences.length} silence intervals`,
  );

  progress("planning", 0, 0, undefined, "Planning segments...");
  const cuts = planCuts(
    totalDuration,
    settings.targetPartDurationSec,
    settings.playbackSpeed,
    silences,
  );
  const totalParts = cuts.length;
  progress(
    "planning",
    100,
    totalParts,
    undefined,
    `${totalParts} parts planned`,
  );

  createZipWriter();

  // Pre-request all TTS prefixes upfront so the main thread generates them
  // in parallel with ffmpeg encoding. Results stream back as each completes.
  const ttsPromises: Promise<Blob>[] = settings.spokenPrefix
    ? cuts.map((cut, i) =>
        requestTTS(
          buildSpeechText(
            i,
            settings.podcastTitle,
            cut.startSec,
            cut.endSec,
          ),
        ),
      )
    : [];

  // Load additional ffmpeg instances for parallel encoding and write a
  // fresh copy of the source to each. Memory cost: parallelism × sourceSize
  // in WASM heaps.
  const pool = await getFFmpegPool(parallelism, settings.preferMultiThread);
  await Promise.all(
    pool.map(async (ff, idx) => {
      if (idx === 0) return; // ff0 already has the file
      await ff.writeFile(INPUT_FILE, new Uint8Array(sourceBuffer!.slice(0)));
    }),
  );
  // Release the retained source buffer now that every instance has a copy.
  sourceBuffer = null;

  // 8. Queue-based parallel encoding. Each ffmpeg instance pulls the next
  // available part index from a shared counter and encodes it. Completed
  // parts are buffered and added to the ZIP in strict part-index order.
  const completedParts = new Map<number, Uint8Array>();
  let nextZipIndex = 0;
  let partCursor = 0;
  let partsCompleted = 0;

  async function flushReadyZipEntries(): Promise<void> {
    while (completedParts.has(nextZipIndex)) {
      const data = completedParts.get(nextZipIndex)!;
      const fname = partFilename(nextZipIndex, totalParts, settings.podcastTitle);
      await addPartToZip(fname, data);
      completedParts.delete(nextZipIndex);
      nextZipIndex++;
    }
  }

  const parallelLabel =
    parallelism > 1 ? ` (${parallelism} parallel)` : "";

  async function encodeOne(
    ff: (typeof pool)[number],
    partIdx: number,
  ): Promise<void> {
    const cut = cuts[partIdx]!;
    const outputFile = `part_${partIdx}.mp3`;

    if (settings.spokenPrefix) {
      const wavBlob = await ttsPromises[partIdx]!;
      const wavData = new Uint8Array(await wavBlob.arrayBuffer());
      const prefixFile = `prefix_${partIdx}.wav`;
      await ff.writeFile(prefixFile, wavData);
      await encodePartWithPrefix(
        ff,
        prefixFile,
        INPUT_FILE,
        cut.startSec,
        cut.endSec,
        settings.playbackSpeed,
        settings.outputBitrate,
        outputFile,
      );
      const partData = await ff.readFile(outputFile);
      completedParts.set(partIdx, partData as Uint8Array);
      await cleanupFiles(ff, prefixFile, outputFile);
    } else {
      await encodePartNoPrefix(
        ff,
        INPUT_FILE,
        cut.startSec,
        cut.endSec,
        settings.playbackSpeed,
        settings.outputBitrate,
        outputFile,
      );
      const partData = await ff.readFile(outputFile);
      completedParts.set(partIdx, partData as Uint8Array);
      await cleanupFiles(ff, outputFile);
    }

    partsCompleted++;
    progress(
      "encoding",
      100,
      totalParts,
      partsCompleted,
      `${partsCompleted} of ${totalParts} parts complete${parallelLabel}`,
    );
  }

  async function workerLoop(ff: (typeof pool)[number]): Promise<void> {
    while (true) {
      const partIdx = partCursor++;
      if (partIdx >= cuts.length) return;
      await encodeOne(ff, partIdx);
      await flushReadyZipEntries();
    }
  }

  progress(
    "encoding",
    0,
    totalParts,
    0,
    `0 of ${totalParts} parts complete${parallelLabel}`,
  );

  await Promise.all(pool.map((ff) => workerLoop(ff)));

  progress("zipping", 50, totalParts, undefined, "Building ZIP file...");
  const zipBlob = await finalizeZip();
  progress("zipping", 100, totalParts, undefined, "ZIP ready");

  await Promise.all(pool.map((ff) => cleanupFiles(ff, INPUT_FILE)));
  terminateFFmpeg();

  post({ type: "COMPLETE", payload: { zipBlob } });
}

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  if (e.data.type === "START_JOB") {
    const caps = detectCapabilities();
    post({ type: "CAPABILITIES", payload: caps });

    try {
      await runPipeline(
        e.data.payload.file,
        e.data.payload.settings,
        e.data.payload.durationSec,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      post({
        type: "ERROR",
        payload: { message, phase: currentPhase, recoverable: false },
      });
    }
  } else if (e.data.type === "TTS_RESULT") {
    // Main thread synthesized the WAV and sent it back
    const { id, wavBlob } = e.data.payload;
    const resolve = pendingTTS.get(id);
    if (resolve) {
      resolve(wavBlob);
      pendingTTS.delete(id);
    }
  }
};
