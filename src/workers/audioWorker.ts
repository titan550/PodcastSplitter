import type {
  WorkerInMessage,
  WorkerOutMessage,
  ProcessingSettings,
  Phase,
  Chapter,
  SplitMode,
  CutPoint,
  SilenceInterval,
  SourceMetadata,
} from "../types";
import { detectCapabilities } from "../lib/runtimeCapabilities";
import { maxPartCount } from "../lib/partCount";
import {
  getFFmpeg,
  getFFmpegPool,
  terminateFFmpeg,
  encodePart,
  cleanupFiles,
} from "../lib/ffmpegClient";
import { buildPartTags } from "../lib/tagBuilder";
import { detectSilences } from "../lib/silenceDetection";
import {
  anyChapterWillSubdivide,
  planCutsByCount,
  planCutsFromChapters,
} from "../lib/cutPlanner";
import { buildEndSpeechText, buildSpeechText } from "../lib/tts/speechText";
import { partFilename } from "../lib/filename";
import { splitExt } from "../lib/supportedFormats";
import { createZipWriter, addPartToZip, finalizeZip } from "../lib/exportZip";

let currentPhase: Phase = "loading";

// ffmpeg is loaded lazily inside runPipeline; its startup cost overlaps
// with the main-thread TTS model download triggered at mount.

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

const COVER_FILE = "cover.jpg";
const BEGIN_CHIME_FILE = "begin_chime.wav";
const END_CHIME_FILE = "end_chime.wav";

async function runPipeline(
  file: File,
  settings: ProcessingSettings,
  totalDuration: number,
  splitMode: SplitMode,
  chapters: Chapter[],
  sourceMetadata: SourceMetadata,
  beginChime: ArrayBuffer,
  endChime: ArrayBuffer,
  targetPartCount: number,
): Promise<void> {
  if (totalDuration <= 0) {
    throw new Error("Could not determine audio duration");
  }
  if (!Number.isFinite(settings.playbackSpeed) || settings.playbackSpeed <= 0) {
    throw new Error("Invalid playback speed");
  }
  const maxParts = maxPartCount(totalDuration, settings.playbackSpeed);
  if (
    !Number.isInteger(targetPartCount) ||
    targetPartCount < 1 ||
    targetPartCount > maxParts
  ) {
    throw new Error(
      `Invalid part count ${targetPartCount} (valid range 1..${maxParts})`,
    );
  }
  const derivedTargetSec =
    totalDuration / settings.playbackSpeed / targetPartCount;

  const parallelism = settings.parallelEncoding;

  // Preserve the source extension so ffmpeg picks the right demuxer.
  const INPUT_FILE = `input${splitExt(file.name).toLowerCase() || ".mp3"}`;

  progress("loading", 0, 0, undefined, "Loading audio engine...");
  const ff0 = await getFFmpeg();
  progress("loading", 100, 0, undefined, "Audio engine ready");

  progress("analyzing", 0, 0, undefined, "Reading audio file...");
  // Retain the raw ArrayBuffer for slice() copies into any additional
  // pool instances; ffmpeg.writeFile transfers (detaches) whatever we
  // hand it, so the primary write must also use a fresh copy.
  let sourceBuffer: ArrayBuffer | null = await file.arrayBuffer();
  await ff0.writeFile(INPUT_FILE, new Uint8Array(sourceBuffer.slice(0)));

  // Time mode always needs silences for cut snapping. Chapter mode only
  // needs them when at least one chapter exceeds the target ceiling and
  // will be subdivided — short-chapter podcasts skip the ffmpeg pass
  // entirely, saving several seconds per job.
  const useChapters = splitMode === "chapters" && chapters.length > 0;
  const needsSilences =
    !useChapters ||
    anyChapterWillSubdivide(
      chapters,
      totalDuration,
      derivedTargetSec,
      settings.playbackSpeed,
    );

  let silences: SilenceInterval[] = [];
  if (needsSilences) {
    progress("analyzing", 30, 0, undefined, "Detecting silences...");
    silences = await detectSilences(
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
  } else {
    progress("analyzing", 100, 0, undefined, "Using chapter boundaries");
  }

  let cuts: CutPoint[];
  if (useChapters) {
    progress("planning", 0, 0, undefined, "Planning from chapters...");
    cuts = planCutsFromChapters(
      chapters,
      totalDuration,
      derivedTargetSec,
      settings.playbackSpeed,
      silences,
    );
  } else {
    progress("planning", 0, 0, undefined, "Planning segments...");
    cuts = planCutsByCount(totalDuration, targetPartCount, silences);
  }
  const totalParts = cuts.length;
  progress(
    "planning",
    100,
    totalParts,
    undefined,
    `${totalParts} parts planned`,
  );

  createZipWriter();

  // Pre-request all TTS prefixes + suffixes upfront so the main thread
  // generates them in parallel with ffmpeg encoding. Requests are
  // INTERLEAVED (prefix[0], suffix[0], prefix[1], suffix[1], ...) so
  // part 0 only waits for 2 synthesis operations before its encode can
  // start — instead of (N+1) if we queued all prefixes before all
  // suffixes.
  const ttsPrefixPromises: Promise<Blob>[] = [];
  const ttsSuffixPromises: Promise<Blob>[] = [];
  if (settings.spokenAnnouncements) {
    for (let i = 0; i < cuts.length; i++) {
      const cut = cuts[i]!;
      const prefixText = cut.chapter
        ? buildSpeechText({
            kind: "chapter",
            partIndex: i,
            totalParts,
            chapterNumber: cut.chapter.number,
            totalChapters: cut.chapter.totalChapters,
            podcastTitle: settings.podcastTitle,
            chapterTitle: cut.chapter.title,
            subPart: cut.chapter.part,
          })
        : buildSpeechText({
            kind: "time",
            partIndex: i,
            totalParts,
            podcastTitle: settings.podcastTitle,
            startSec: cut.startSec,
            endSec: cut.endSec,
          });
      ttsPrefixPromises.push(requestTTS(prefixText));
      ttsSuffixPromises.push(requestTTS(buildEndSpeechText(i, totalParts)));
    }
  }

  // Load additional ffmpeg instances for parallel encoding and write a
  // fresh copy of the source to each. Memory cost: parallelism × sourceSize
  // in WASM heaps.
  const pool = await getFFmpegPool(parallelism);
  const hasCover = !!sourceMetadata.coverArt;
  // Retain cover bytes for slice() copies — ff.writeFile detaches the
  // backing buffer, so each instance needs a fresh copy.
  const coverBytes = sourceMetadata.coverArt?.data ?? null;
  await Promise.all(
    pool.map(async (ff, idx) => {
      if (idx === 0) {
        if (hasCover)
          await ff.writeFile(COVER_FILE, new Uint8Array(coverBytes!.buffer.slice(0)));
        await ff.writeFile(BEGIN_CHIME_FILE, new Uint8Array(beginChime.slice(0)));
        await ff.writeFile(END_CHIME_FILE, new Uint8Array(endChime.slice(0)));
        return;
      }
      await ff.writeFile(INPUT_FILE, new Uint8Array(sourceBuffer!.slice(0)));
      if (hasCover)
        await ff.writeFile(COVER_FILE, new Uint8Array(coverBytes!.buffer.slice(0)));
      await ff.writeFile(BEGIN_CHIME_FILE, new Uint8Array(beginChime.slice(0)));
      await ff.writeFile(END_CHIME_FILE, new Uint8Array(endChime.slice(0)));
    }),
  );
  // Release the retained source buffer now that every instance has a copy.
  sourceBuffer = null;

  // Queue-based parallel encoding. Each ffmpeg instance pulls the next
  // available part index from a shared counter and encodes it. Completed
  // parts are buffered and added to the ZIP in strict part-index order
  // via a promise-chain mutex — without the chain, two workerLoops can
  // observe the same nextZipIndex and double-add the part.
  const completedParts = new Map<number, Uint8Array>();
  let nextZipIndex = 0;
  let partCursor = 0;
  let partsCompleted = 0;
  let flushChain: Promise<void> = Promise.resolve();

  function flushReadyZipEntries(): Promise<void> {
    // Deliberately do NOT .catch the chain: if addPartToZip ever throws
    // the ZIP is already corrupt, so the rejection must propagate through
    // every subsequent flush caller, fail Promise.all(workerLoops), and
    // abort runPipeline via the outer try/catch. Silently continuing the
    // chain would produce a broken ZIP with no error surfaced to the user.
    flushChain = flushChain.then(async () => {
      while (completedParts.has(nextZipIndex)) {
        const data = completedParts.get(nextZipIndex)!;
        const cut = cuts[nextZipIndex]!;
        const fname = partFilename(
          nextZipIndex,
          totalParts,
          settings.podcastTitle,
          cut.chapter,
        );
        await addPartToZip(fname, data);
        completedParts.delete(nextZipIndex);
        nextZipIndex++;
      }
    });
    return flushChain;
  }

  const parallelLabel =
    parallelism > 1 ? ` (${parallelism} parallel)` : "";

  async function encodeOne(
    ff: (typeof pool)[number],
    partIdx: number,
  ): Promise<void> {
    const cut = cuts[partIdx]!;
    const outputFile = `part_${partIdx}.mp3`;

    const skipSilence = settings.skipLongSilences
      ? {
          minDurationSec: settings.skipLongSilenceMinSec,
          thresholdDb: settings.silenceRemovalThresholdDb,
        }
      : undefined;

    const tags = buildPartTags({
      cut,
      totalParts,
      podcastTitle: settings.podcastTitle,
      source: sourceMetadata,
    });

    let prefixFile: string | undefined;
    let suffixFile: string | undefined;
    const cleanFiles: string[] = [outputFile];
    if (settings.spokenAnnouncements) {
      const prefixBlob = await ttsPrefixPromises[partIdx]!;
      const suffixBlob = await ttsSuffixPromises[partIdx]!;
      const prefixData = new Uint8Array(await prefixBlob.arrayBuffer());
      const suffixData = new Uint8Array(await suffixBlob.arrayBuffer());
      prefixFile = `prefix_${partIdx}.wav`;
      suffixFile = `suffix_${partIdx}.wav`;
      await ff.writeFile(prefixFile, prefixData);
      await ff.writeFile(suffixFile, suffixData);
      cleanFiles.push(prefixFile, suffixFile);
    }

    await encodePart(ff, {
      inputFile: INPUT_FILE,
      prefixFile,
      suffixFile,
      beginChimeFile: BEGIN_CHIME_FILE,
      endChimeFile: END_CHIME_FILE,
      coverFile: hasCover ? COVER_FILE : undefined,
      startSec: cut.startSec,
      endSec: cut.endSec,
      speed: settings.playbackSpeed,
      bitrate: settings.outputBitrate,
      outputFile,
      skipSilence,
      sourceSampleRate: sourceMetadata.sampleRate,
      sourceChannels: sourceMetadata.numberOfChannels,
      audioProfile: settings.audioProfile,
      tags,
    });

    const partData = await ff.readFile(outputFile);
    completedParts.set(partIdx, partData as Uint8Array);

    await cleanupFiles(ff, ...cleanFiles);

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

  const finalClean = [INPUT_FILE, BEGIN_CHIME_FILE, END_CHIME_FILE];
  if (hasCover) finalClean.push(COVER_FILE);
  await Promise.all(pool.map((ff) => cleanupFiles(ff, ...finalClean)));
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
        e.data.payload.splitMode,
        e.data.payload.chapters,
        e.data.payload.sourceMetadata,
        e.data.payload.beginChime,
        e.data.payload.endChime,
        e.data.payload.targetPartCount,
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
