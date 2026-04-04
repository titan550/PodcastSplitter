export function deriveTitle(file: File): string {
  return (
    file.name
      .replace(/\.mp3$/i, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Podcast"
  );
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function partFilename(
  partIndex: number,
  totalParts: number,
  title: string,
): string {
  const padWidth = Math.max(String(totalParts).length, 2);
  const num = String(partIndex + 1).padStart(padWidth, "0");
  const safe = sanitizeFilename(title);
  return `${num} - ${safe} - Part ${num}.mp3`;
}

export function zipFilename(title: string): string {
  return `${sanitizeFilename(title)}.zip`;
}
