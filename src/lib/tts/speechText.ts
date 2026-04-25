export type SpeechTextArgs =
  | {
      kind: "time";
      partIndex: number;
      totalParts: number;
      podcastTitle: string;
      startSec: number;
      endSec: number;
    }
  | {
      kind: "chapter";
      partIndex: number;
      totalParts: number;
      chapterNumber: number;
      totalChapters: number;
      podcastTitle: string;
      chapterTitle: string;
      // Present only when the chapter is subdivided into multiple sub-parts.
      subPart?: { index: number; count: number };
    };

/**
 * Builds the spoken prefix text that gets synthesized by Piper and
 * prepended to each encoded part. Every mode leads with the global
 * counter ("Part X of TOTAL.") so listeners always know where they are
 * in the series; the period after TOTAL separates it cleanly from the
 * podcast name (avoids "of nine of My Podcast").
 *
 * - Time:                 "Part X of TOTAL. {Title}. Minutes A to B."
 * - Chapter, single:      "Part X of TOTAL. {Title}. Chapter N of M. {Chapter Title}."
 * - Chapter, sub-part 1:  "Part X of TOTAL. {Title}. Chapter N of M. {Chapter Title}, segment 1 of K."
 * - Chapter, sub-part 2+: "Part X of TOTAL. {Title}. Chapter N of M, segment M of K."
 *
 * Sub-parts 2+ drop the chapter title to avoid audio clutter — the
 * listener already heard it on part 1.
 */
export function buildSpeechText(args: SpeechTextArgs): string {
  const partHeader = `Part ${args.partIndex + 1} of ${args.totalParts}`;

  if (args.kind === "chapter") {
    const chapterHeader = `Chapter ${args.chapterNumber} of ${args.totalChapters}`;
    const title = args.chapterTitle.trim();
    const sub = args.subPart;

    if (!sub) {
      return title
        ? `${partHeader}. ${args.podcastTitle}. ${chapterHeader}. ${title}.`
        : `${partHeader}. ${args.podcastTitle}. ${chapterHeader}.`;
    }
    if (sub.index === 1) {
      return title
        ? `${partHeader}. ${args.podcastTitle}. ${chapterHeader}. ${title}, segment 1 of ${sub.count}.`
        : `${partHeader}. ${args.podcastTitle}. ${chapterHeader}, segment 1 of ${sub.count}.`;
    }
    return `${partHeader}. ${args.podcastTitle}. ${chapterHeader}, segment ${sub.index} of ${sub.count}.`;
  }

  const startMin = Math.floor(args.startSec / 60);
  const endMin = Math.floor(args.endSec / 60);
  return `${partHeader}. ${args.podcastTitle}. Minutes ${startMin} to ${endMin}.`;
}

/** End-of-part announcement. Same shape across all modes. */
export function buildEndSpeechText(partIndex: number, totalParts: number): string {
  return `End of part ${partIndex + 1} of ${totalParts}.`;
}
