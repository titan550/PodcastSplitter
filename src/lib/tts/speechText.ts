export type SpeechTextArgs =
  | {
      kind: "time";
      partIndex: number;
      podcastTitle: string;
      startSec: number;
      endSec: number;
    }
  | {
      kind: "chapter";
      chapterNumber: number;
      podcastTitle: string;
      chapterTitle: string;
      // Present only when the chapter is subdivided into multiple sub-parts.
      subPart?: { index: number; count: number };
    };

/**
 * Builds the spoken prefix text that gets synthesized by Piper and
 * prepended to each encoded part.
 *
 * - Time mode:             "Part {N} of {Title}. Minutes {A} to {B}"
 * - Chapter, single part:  "Chapter {N} of {Title}. {Chapter Title}"
 * - Chapter, sub-part 1:   "Chapter {N} of {Title}. {Chapter Title}, part 1 of K"
 * - Chapter, sub-part 2+:  "Chapter {N} of {Title}, part M of K"
 *
 * Sub-parts 2+ drop the chapter title: listeners who just finished part 1
 * know which chapter they're in, and repeating a long title every few
 * minutes is audio clutter. Short, rhythmically predictable prefixes
 * serve track-skip navigation better.
 *
 * An empty / whitespace chapter title falls back to omitting the title
 * fragment entirely to avoid a dangling full stop in synthesized speech.
 */
export function buildSpeechText(args: SpeechTextArgs): string {
  if (args.kind === "chapter") {
    const header = `Chapter ${args.chapterNumber} of ${args.podcastTitle}`;
    const title = args.chapterTitle.trim();
    const sub = args.subPart;

    if (!sub) {
      return title ? `${header}. ${title}` : header;
    }
    if (sub.index === 1) {
      return title
        ? `${header}. ${title}, part 1 of ${sub.count}`
        : `${header}, part 1 of ${sub.count}`;
    }
    return `${header}, part ${sub.index} of ${sub.count}`;
  }
  const base = `Part ${args.partIndex + 1} of ${args.podcastTitle}`;
  const startMin = Math.floor(args.startSec / 60);
  const endMin = Math.floor(args.endSec / 60);
  return `${base}. Minutes ${startMin} to ${endMin}`;
}
