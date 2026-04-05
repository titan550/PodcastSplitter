import { describe, it, expect } from "vitest";
import {
  deriveTitle,
  slugFilenameSegment,
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

describe("slugFilenameSegment", () => {
  it("lowercases and replaces spaces with underscore", () => {
    expect(slugFilenameSegment("My Great Show")).toBe("my_great_show");
  });

  it("normalizes accented letters to ASCII", () => {
    expect(slugFilenameSegment("Café Story")).toBe("cafe_story");
  });

  it("drops emoji and other non-ASCII symbols", () => {
    expect(slugFilenameSegment("Café ☕ Story")).toBe("cafe_story");
  });

  it("strips apostrophes before punctuation collapse", () => {
    expect(slugFilenameSegment("Don't Stop Believin'")).toBe(
      "dont_stop_believin",
    );
  });

  it("strips curly apostrophes too", () => {
    expect(slugFilenameSegment("Don\u2019t Stop")).toBe("dont_stop");
  });

  it("collapses runs of punctuation into single underscore", () => {
    expect(slugFilenameSegment("foo -- bar :: baz")).toBe("foo_bar_baz");
  });

  it("trims leading and trailing underscores", () => {
    expect(slugFilenameSegment("  hello world  ")).toBe("hello_world");
  });

  it("returns empty string for inputs with no sluggable chars", () => {
    expect(slugFilenameSegment("")).toBe("");
    expect(slugFilenameSegment("///")).toBe("");
    expect(slugFilenameSegment("☕☕☕")).toBe("");
  });

  it("collapses repeated underscores", () => {
    expect(slugFilenameSegment("a___b")).toBe("a_b");
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

  it("formats with hash, global index, slug, and part suffix", () => {
    const h = hashOf("My Podcast");
    expect(partFilename(0, 5, "My Podcast")).toBe(
      `${h}_01_my_podcast__part_01.mp3`,
    );
  });

  it("pads global index and part number to match total", () => {
    const h = hashOf("My Podcast");
    expect(partFilename(9, 25, "My Podcast")).toBe(
      `${h}_10_my_podcast__part_10.mp3`,
    );
  });

  it("pads to 3 digits for 100+ parts", () => {
    const h = hashOf("Show");
    expect(partFilename(0, 100, "Show")).toBe(`${h}_001_show__part_001.mp3`);
  });

  it("slug-sanitizes title (drops punctuation)", () => {
    const h = hashOf('Bad: "Title"');
    expect(partFilename(0, 3, 'Bad: "Title"')).toBe(
      `${h}_01_bad_title__part_01.mp3`,
    );
  });

  it("caps total length at 150 chars with pathological title", () => {
    const longTitle = "X".repeat(500);
    const name = partFilename(0, 5, longTitle);
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name.endsWith(".mp3")).toBe(true);
    expect(name).toContain("_01_"); // global index survives
    expect(name).toContain("__part_01."); // part suffix survives
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

  it("empty title falls back to 'untitled' slug", () => {
    const h = hashOf("");
    expect(partFilename(0, 3, "")).toBe(`${h}_01_untitled__part_01.mp3`);
  });
});

describe("partFilename (chapter mode, single part)", () => {
  const hashOf = (t: string) => titleHash(t);

  it("formats with ch_{NN} and chapter slug", () => {
    const h = hashOf("My Show");
    expect(
      partFilename(0, 3, "My Show", {
        title: "Introduction",
        number: 1,
        totalChapters: 3,
      }),
    ).toBe(`${h}_01_my_show__ch_01_introduction.mp3`);
  });

  it("pads chapterNumber to match totalChapters", () => {
    const h = hashOf("Show");
    expect(
      partFilename(0, 12, "Show", {
        title: "Start",
        number: 3,
        totalChapters: 12,
      }),
    ).toBe(`${h}_01_show__ch_03_start.mp3`);
  });

  it("pads chapterNumber to 3 digits for 100+ chapters", () => {
    const h = hashOf("Audiobook");
    expect(
      partFilename(0, 150, "Audiobook", {
        title: "First",
        number: 3,
        totalChapters: 150,
      }),
    ).toBe(`${h}_001_audiobook__ch_003_first.mp3`);
  });

  it("slug-sanitizes chapter title (drops punctuation)", () => {
    const h = hashOf("Show");
    expect(
      partFilename(0, 3, "Show", {
        title: 'Chap/ter: "One"',
        number: 1,
        totalChapters: 3,
      }),
    ).toBe(`${h}_01_show__ch_01_chap_ter_one.mp3`);
  });

  it("falls back to 'chapter_{NN}' when chapter slug is empty", () => {
    const h = hashOf("Show");
    expect(
      partFilename(2, 5, "Show", {
        title: "///",
        number: 3,
        totalChapters: 5,
      }),
    ).toBe(`${h}_03_show__ch_03_chapter_03.mp3`);
  });

  it("apostrophes in chapter title collapse cleanly", () => {
    const h = hashOf("Show");
    expect(
      partFilename(0, 3, "Show", {
        title: "Don't Stop",
        number: 1,
        totalChapters: 3,
      }),
    ).toBe(`${h}_01_show__ch_01_dont_stop.mp3`);
  });

  it("non-ASCII chapter title slugs to ASCII", () => {
    const h = hashOf("Show");
    expect(
      partFilename(0, 3, "Show", {
        title: "Café ☕ Story",
        number: 1,
        totalChapters: 3,
      }),
    ).toBe(`${h}_01_show__ch_01_cafe_story.mp3`);
  });
});

describe("partFilename (chapter mode, sub-part)", () => {
  const hashOf = (t: string) => titleHash(t);

  it("appends __p_{N}_of_{M} suffix", () => {
    const h = hashOf("My Show");
    expect(
      partFilename(12, 20, "My Show", {
        title: "The Real Story",
        number: 3,
        totalChapters: 5,
        part: { index: 2, count: 4 },
      }),
    ).toBe(`${h}_13_my_show__ch_03_the_real_story__p_2_of_4.mp3`);
  });

  it("first sub-part uses p_1_of_K", () => {
    const h = hashOf("Show");
    const name = partFilename(0, 10, "Show", {
      title: "Chapter One",
      number: 1,
      totalChapters: 3,
      part: { index: 1, count: 3 },
    });
    expect(name).toBe(`${h}_01_show__ch_01_chapter_one__p_1_of_3.mp3`);
  });
});

describe("partFilename length cap and truncation priority", () => {
  it("caps pathologically long title and chapter, preserves structural fields", () => {
    const longTitle = "x".repeat(400);
    const longChapter = "y".repeat(400);
    const name = partFilename(12, 100, longTitle, {
      title: longChapter,
      number: 3,
      totalChapters: 50,
      part: { index: 2, count: 4 },
    });
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name.endsWith(".mp3")).toBe(true);
    // Structural fields survive:
    expect(name).toMatch(/^[0-9a-z]{4}_013_/); // hash + global index
    expect(name).toContain("__ch_03_"); // chapter number
    expect(name).toContain("__p_2_of_4."); // sub-part suffix
  });

  it("truncates podcast slug first, keeps chapter slug intact when possible", () => {
    const longTitle = "x".repeat(400);
    const shortChapter = "short_chapter";
    const name = partFilename(0, 5, longTitle, {
      title: shortChapter,
      number: 1,
      totalChapters: 3,
    });
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name).toContain("short_chapter"); // chapter slug preserved
  });

  it("time-mode pathological title caps at 150 and preserves part suffix", () => {
    const longTitle = "x".repeat(400);
    const name = partFilename(0, 5, longTitle);
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name).toContain("__part_01.mp3");
  });

  it("never emits spaces, parens, commas, or apostrophes", () => {
    const name = partFilename(0, 3, "My Podcast's Great Show!", {
      title: "Chapter: (One)",
      number: 1,
      totalChapters: 3,
      part: { index: 1, count: 2 },
    });
    expect(name).not.toMatch(/[ ()',]/);
  });
});

describe("zipFilename", () => {
  it("prepends hash to slugged title", () => {
    const h = titleHash("My Podcast");
    expect(zipFilename("My Podcast")).toBe(`${h}_my_podcast.zip`);
  });

  it("caps length at 150 chars", () => {
    const longTitle = "Z".repeat(500);
    const name = zipFilename(longTitle);
    expect(name.length).toBeLessThanOrEqual(150);
    expect(name.endsWith(".zip")).toBe(true);
  });
});
