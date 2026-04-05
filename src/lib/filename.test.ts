import { describe, it, expect } from "vitest";
import {
  deriveTitle,
  sanitizeFilename,
  partFilename,
  zipFilename,
  titleHash,
  truncateFilename,
} from "./filename";

describe("deriveTitle", () => {
  it("strips .mp3 and replaces separators", () => {
    expect(deriveTitle(new File([], "my_cool-podcast.mp3"))).toBe(
      "my cool podcast",
    );
  });

  it("handles uppercase extension", () => {
    expect(deriveTitle(new File([], "Episode_42.MP3"))).toBe("Episode 42");
  });

  it("strips other audio extensions", () => {
    expect(deriveTitle(new File([], "show.m4a"))).toBe("show");
    expect(deriveTitle(new File([], "episode.wav"))).toBe("episode");
  });

  it("returns 'Podcast' for empty stem", () => {
    expect(deriveTitle(new File([], ".mp3"))).toBe("Podcast");
  });

  it("handles spaces in filename", () => {
    expect(deriveTitle(new File([], "My Great Show.mp3"))).toBe(
      "My Great Show",
    );
  });
});

describe("sanitizeFilename", () => {
  it("removes illegal characters", () => {
    expect(sanitizeFilename('test<>:"/file')).toBe("testfile");
  });

  it("collapses whitespace", () => {
    expect(sanitizeFilename("a   b   c")).toBe("a b c");
  });

  it("caps at 100 characters", () => {
    const long = "a".repeat(200);
    expect(sanitizeFilename(long)).toHaveLength(100);
  });

  it("removes control characters", () => {
    expect(sanitizeFilename("hello\x00world\x1f")).toBe("helloworld");
  });
});

describe("titleHash", () => {
  it("is exactly 4 characters of base36", () => {
    expect(titleHash("My Podcast")).toMatch(/^[0-9a-z]{4}$/);
  });

  it("is deterministic", () => {
    expect(titleHash("My Podcast")).toBe(titleHash("My Podcast"));
  });

  it("distinguishes different titles", () => {
    expect(titleHash("Podcast A")).not.toBe(titleHash("Podcast B"));
  });

  it("handles empty input", () => {
    expect(titleHash("")).toMatch(/^[0-9a-z]{4}$/);
  });

  it("handles unicode", () => {
    const h = titleHash("Café ☕");
    expect(h).toMatch(/^[0-9a-z]{4}$/);
    expect(titleHash("Café ☕")).toBe(h);
  });
});

describe("truncateFilename", () => {
  it("passes short names through unchanged", () => {
    expect(truncateFilename("short.mp3")).toBe("short.mp3");
  });

  it("caps long names at maxLen while preserving extension", () => {
    const name = "x".repeat(200) + ".mp3";
    const out = truncateFilename(name, 150);
    expect(out.length).toBeLessThanOrEqual(150);
    expect(out.endsWith(".mp3")).toBe(true);
  });

  it("uses default maxLen of 150", () => {
    const name = "y".repeat(500) + ".zip";
    expect(truncateFilename(name).length).toBeLessThanOrEqual(150);
  });

  it("handles names with no extension", () => {
    const name = "z".repeat(200);
    expect(truncateFilename(name, 100)).toHaveLength(100);
  });
});

describe("partFilename (time mode)", () => {
  const hashOf = (t: string) => titleHash(t);

  it("formats with hash, index, title, and Part suffix", () => {
    const h = hashOf("My Podcast");
    expect(partFilename(0, 5, "My Podcast")).toBe(
      `${h} 01 My Podcast - Part 01.mp3`,
    );
  });

  it("pads index to match total", () => {
    const h = hashOf("My Podcast");
    expect(partFilename(9, 25, "My Podcast")).toBe(
      `${h} 10 My Podcast - Part 10.mp3`,
    );
  });

  it("pads to 3 digits for 100+ parts", () => {
    const h = hashOf("Show");
    expect(partFilename(0, 100, "Show")).toBe(
      `${h} 001 Show - Part 001.mp3`,
    );
  });

  it("sanitizes title", () => {
    const h = hashOf('Bad: "Title"');
    expect(partFilename(0, 3, 'Bad: "Title"')).toBe(
      `${h} 01 Bad Title - Part 01.mp3`,
    );
  });

  it("caps total length at 150 chars with pathological title", () => {
    const longTitle = "X".repeat(500);
    const name = partFilename(0, 5, longTitle);
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name.endsWith(".mp3")).toBe(true);
    expect(name).toContain(" 01 "); // numeric index survives
    expect(name).toContain(" - Part 01."); // suffix survives
  });

  it("same title → same hash across parts", () => {
    const a = partFilename(0, 5, "My Show");
    const b = partFilename(4, 5, "My Show");
    expect(a.slice(0, 4)).toBe(b.slice(0, 4));
  });

  it("different titles → different hashes", () => {
    const a = partFilename(0, 5, "Podcast A");
    const b = partFilename(0, 5, "Podcast B");
    expect(a.slice(0, 4)).not.toBe(b.slice(0, 4));
  });
});

describe("partFilename (chapter mode)", () => {
  const hashOf = (t: string) => titleHash(t);

  it("formats with chapter title appended", () => {
    const h = hashOf("My Show");
    expect(partFilename(0, 3, "My Show", "Introduction")).toBe(
      `${h} 01 My Show - 01 Introduction.mp3`,
    );
  });

  it("sanitizes chapter title", () => {
    const h = hashOf("Show");
    expect(partFilename(0, 3, "Show", 'Chap/ter: "One"')).toBe(
      `${h} 01 Show - 01 Chapter One.mp3`,
    );
  });

  it("falls back to 'Chapter N' when chapter title is empty after sanitization", () => {
    const h = hashOf("Show");
    expect(partFilename(2, 5, "Show", "///")).toBe(
      `${h} 03 Show - 03 Chapter 03.mp3`,
    );
  });

  it("caps total length with long title and chapter", () => {
    const longTitle = "X".repeat(400);
    const longChapter = "Y".repeat(400);
    const name = partFilename(0, 5, longTitle, longChapter);
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name.endsWith(".mp3")).toBe(true);
  });
});

describe("zipFilename", () => {
  it("prepends hash to sanitized title", () => {
    const h = titleHash("My Podcast");
    expect(zipFilename("My Podcast")).toBe(`${h} My Podcast.zip`);
  });

  it("caps length at 150 chars", () => {
    const longTitle = "Z".repeat(500);
    const name = zipFilename(longTitle);
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name.endsWith(".zip")).toBe(true);
  });
});
