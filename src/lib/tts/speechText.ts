export function buildSpeechText(
  partIndex: number,
  podcastTitle: string,
  startSec?: number,
  endSec?: number,
): string {
  const base = `Part ${partIndex + 1} of ${podcastTitle}`;
  if (startSec === undefined || endSec === undefined) return base;
  const startMin = Math.floor(startSec / 60);
  const endMin = Math.floor(endSec / 60);
  return `${base}. Minutes ${startMin} to ${endMin}`;
}
