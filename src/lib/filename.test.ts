import { describe, it, expect } from "vitest";
import { deriveTitle, sanitizeFilename, partFilename, zipFilename } from "./filename";

describe("deriveTitle", () => {
  it("strips .mp3 and replaces separators", () => {
    expect(deriveTitle(new File([], "my_cool-podcast.mp3"))).toBe(
      "my cool podcast",
    );
  });

  it("handles uppercase extension", () => {
    expect(deriveTitle(new File([], "Episode_42.MP3"))).toBe("Episode 42");
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

describe("partFilename", () => {
  it("generates correct format for small count", () => {
    expect(partFilename(0, 5, "My Podcast")).toBe(
      "01 - My Podcast - Part 01.mp3",
    );
  });

  it("generates correct format for large count", () => {
    expect(partFilename(9, 25, "My Podcast")).toBe(
      "10 - My Podcast - Part 10.mp3",
    );
  });

  it("pads correctly for 100+ parts", () => {
    expect(partFilename(0, 100, "Show")).toBe("001 - Show - Part 001.mp3");
  });

  it("sanitizes title in filename", () => {
    expect(partFilename(0, 3, 'Bad: "Title"')).toBe(
      "01 - Bad Title - Part 01.mp3",
    );
  });
});

describe("zipFilename", () => {
  it("appends .zip to sanitized title", () => {
    expect(zipFilename("My Podcast")).toBe("My Podcast.zip");
  });
});
