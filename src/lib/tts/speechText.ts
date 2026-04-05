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
      partIndex: number;
      podcastTitle: string;
      chapterTitle: string;
    };

/**
 * Builds the spoken prefix text that gets synthesized by Piper and
 * prepended to each encoded part.
 *
 * - Time mode:    "Part {N} of {Title}. Minutes {A} to {B}"
 * - Chapter mode: "Chapter {N} of {Title}. {Chapter Title}"
 *
 * In chapter mode, an empty/whitespace chapter title falls back to
 * "Chapter N of Title" without the trailing period to avoid a dangling
 * full stop that sounds odd in synthesized speech.
 */
export function buildSpeechText(args: SpeechTextArgs): string {
  if (args.kind === "chapter") {
    const base = `Chapter ${args.partIndex + 1} of ${args.podcastTitle}`;
    const chapter = args.chapterTitle.trim();
    return chapter ? `${base}. ${chapter}` : base;
  }
  const base = `Part ${args.partIndex + 1} of ${args.podcastTitle}`;
  const startMin = Math.floor(args.startSec / 60);
  const endMin = Math.floor(args.endSec / 60);
  return `${base}. Minutes ${startMin} to ${endMin}`;
}
