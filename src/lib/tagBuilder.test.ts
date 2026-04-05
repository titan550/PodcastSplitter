import { describe, it, expect } from "vitest";
import { buildPartTags, sanitizeTagValue } from "./tagBuilder";
import type { CutPoint, SourceMetadata } from "../types";

const emptySrc: SourceMetadata = {
  sampleRate: undefined,
  numberOfChannels: undefined,
  artist: undefined,
  albumartist: undefined,
  album: undefined,
  date: undefined,
  genre: undefined,
  comment: undefined,
  composer: undefined,
  publisher: undefined,
  copyright: undefined,
  language: undefined,
  coverArt: undefined,
};

function tag(tags: ReturnType<typeof buildPartTags>, key: string) {
  return tags.find((t) => t.key === key)?.value;
}

describe("sanitizeTagValue", () => {
  it("strips newlines and control chars", () => {
    expect(sanitizeTagValue("hello\nworld\r\x00!")).toBe("hello world !");
  });

  it("collapses whitespace", () => {
    expect(sanitizeTagValue("  a   b  ")).toBe("a b");
  });

  it("returns undefined for empty input", () => {
    expect(sanitizeTagValue("")).toBeUndefined();
    expect(sanitizeTagValue(undefined)).toBeUndefined();
  });

  it("returns undefined when only whitespace remains", () => {
    expect(sanitizeTagValue("  \n  ")).toBeUndefined();
  });
});

describe("buildPartTags", () => {
  describe("time mode", () => {
    it("sets title to Part N", () => {
      const cut: CutPoint = { startSec: 0, endSec: 300, partIndex: 0 };
      const tags = buildPartTags({
        cut,
        totalParts: 10,
        podcastTitle: "My Show",
        source: emptySrc,
      });
      expect(tag(tags, "title")).toBe("Part 1");
      expect(tag(tags, "track")).toBe("1/10");
    });
  });

  describe("chapter mode, un-subdivided", () => {
    it("uses chapter title", () => {
      const cut: CutPoint = {
        startSec: 0,
        endSec: 600,
        partIndex: 2,
        chapter: { title: "Interview", number: 3, totalChapters: 5 },
      };
      const tags = buildPartTags({
        cut,
        totalParts: 5,
        podcastTitle: "Show",
        source: emptySrc,
      });
      expect(tag(tags, "title")).toBe("Interview");
      expect(tag(tags, "track")).toBe("3/5");
    });
  });

  describe("chapter mode, sub-part", () => {
    it("appends (N of M) to title", () => {
      const cut: CutPoint = {
        startSec: 300,
        endSec: 600,
        partIndex: 4,
        chapter: {
          title: "Deep Dive",
          number: 2,
          totalChapters: 3,
          part: { index: 2, count: 4 },
        },
      };
      const tags = buildPartTags({
        cut,
        totalParts: 10,
        podcastTitle: "Show",
        source: emptySrc,
      });
      expect(tag(tags, "title")).toBe("Deep Dive (2 of 4)");
    });
  });

  describe("empty chapter title", () => {
    it("falls back to Chapter N", () => {
      const cut: CutPoint = {
        startSec: 0,
        endSec: 300,
        partIndex: 0,
        chapter: { title: "", number: 3, totalChapters: 5 },
      };
      const tags = buildPartTags({
        cut,
        totalParts: 5,
        podcastTitle: "Show",
        source: emptySrc,
      });
      expect(tag(tags, "title")).toBe("Chapter 3");
    });
  });

  describe("album precedence", () => {
    it("source.album takes priority over podcastTitle", () => {
      const tags = buildPartTags({
        cut: { startSec: 0, endSec: 300, partIndex: 0 },
        totalParts: 1,
        podcastTitle: "Episode 42: Great Interview",
        source: { ...emptySrc, album: "The Daily" },
      });
      expect(tag(tags, "album")).toBe("The Daily");
    });

    it("falls back to podcastTitle when source has no album", () => {
      const tags = buildPartTags({
        cut: { startSec: 0, endSec: 300, partIndex: 0 },
        totalParts: 1,
        podcastTitle: "Fallback Title",
        source: emptySrc,
      });
      expect(tag(tags, "album")).toBe("Fallback Title");
    });

    it("omits album when both are empty", () => {
      const tags = buildPartTags({
        cut: { startSec: 0, endSec: 300, partIndex: 0 },
        totalParts: 1,
        podcastTitle: "",
        source: emptySrc,
      });
      expect(tag(tags, "album")).toBeUndefined();
    });
  });

  describe("artist / album_artist fallback", () => {
    it("album_artist falls back to artist when albumartist is absent", () => {
      const tags = buildPartTags({
        cut: { startSec: 0, endSec: 300, partIndex: 0 },
        totalParts: 1,
        podcastTitle: "Show",
        source: { ...emptySrc, artist: "Jane Doe" },
      });
      expect(tag(tags, "album_artist")).toBe("Jane Doe");
      expect(tag(tags, "artist")).toBe("Jane Doe");
    });

    it("uses albumartist when both are present", () => {
      const tags = buildPartTags({
        cut: { startSec: 0, endSec: 300, partIndex: 0 },
        totalParts: 1,
        podcastTitle: "Show",
        source: {
          ...emptySrc,
          artist: "Jane Doe",
          albumartist: "The Jane Doe Show",
        },
      });
      expect(tag(tags, "album_artist")).toBe("The Jane Doe Show");
      expect(tag(tags, "artist")).toBe("Jane Doe");
    });
  });

  describe("source fields passthrough", () => {
    it("copies all present source fields", () => {
      const src: SourceMetadata = {
        ...emptySrc,
        artist: "Host",
        album: "My Podcast",
        date: "2024",
        genre: "Comedy",
        comment: "A short comment",
        composer: "Composer X",
        publisher: "Publisher Y",
        copyright: "2024 Host",
        language: "en",
      };
      const tags = buildPartTags({
        cut: { startSec: 0, endSec: 300, partIndex: 0 },
        totalParts: 1,
        podcastTitle: "Show",
        source: src,
      });
      expect(tag(tags, "date")).toBe("2024");
      expect(tag(tags, "genre")).toBe("Comedy");
      expect(tag(tags, "comment")).toBe("A short comment");
      expect(tag(tags, "composer")).toBe("Composer X");
      expect(tag(tags, "publisher")).toBe("Publisher Y");
      expect(tag(tags, "copyright")).toBe("2024 Host");
      expect(tag(tags, "language")).toBe("en");
    });

    it("omits absent source fields", () => {
      const tags = buildPartTags({
        cut: { startSec: 0, endSec: 300, partIndex: 0 },
        totalParts: 1,
        podcastTitle: "Show",
        source: emptySrc,
      });
      expect(tag(tags, "artist")).toBeUndefined();
      expect(tag(tags, "date")).toBeUndefined();
      expect(tag(tags, "genre")).toBeUndefined();
    });
  });

  it("always emits encoder", () => {
    const tags = buildPartTags({
      cut: { startSec: 0, endSec: 300, partIndex: 0 },
      totalParts: 1,
      podcastTitle: "",
      source: emptySrc,
    });
    expect(tag(tags, "encoder")).toBe("Podcast Splitter");
  });
});
