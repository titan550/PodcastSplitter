import type { CutPoint, SourceMetadata, Tag } from "../types";

export interface TagContext {
  cut: CutPoint;
  totalParts: number;
  podcastTitle: string;
  source: SourceMetadata;
}

/** Strip control chars and collapse whitespace. Returns undefined for
 *  empty-after-sanitize to prevent emitting empty-value metadata flags. */
export function sanitizeTagValue(v: string | undefined): string | undefined {
  if (!v) return undefined;
  // eslint-disable-next-line no-control-regex -- strip control chars from metadata tags
  const clean = v.replace(/[\r\n\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim();
  return clean || undefined;
}

function partTitle(cut: CutPoint): string {
  if (!cut.chapter) {
    return `Part ${cut.partIndex + 1}`;
  }
  const ch = cut.chapter;
  const title = ch.title.trim() || `Chapter ${ch.number}`;
  if (ch.part) {
    return `${title} (${ch.part.index} of ${ch.part.count})`;
  }
  return title;
}

/** Build the list of `-metadata key=value` pairs for one encoded part. */
export function buildPartTags(ctx: TagContext): Tag[] {
  const { cut, totalParts, podcastTitle, source } = ctx;
  const tags: Tag[] = [];

  const push = (key: string, value: string | undefined) => {
    const clean = sanitizeTagValue(value);
    if (clean) tags.push({ key, value: clean });
  };

  push("title", partTitle(cut));
  push("track", `${cut.partIndex + 1}/${totalParts}`);
  push("album", source.album ?? podcastTitle);
  push("album_artist", source.albumartist ?? source.artist);
  push("artist", source.artist);
  push("date", source.date);
  push("genre", source.genre);
  push("comment", source.comment);
  push("composer", source.composer);
  push("publisher", source.publisher);
  push("copyright", source.copyright);
  push("language", source.language);

  // Always set encoder for provenance.
  tags.push({ key: "encoder", value: "Podcast Splitter" });

  return tags;
}
