import { describe, it, expect } from "vitest";
import { buildSpeechText } from "./speechText";

describe("buildSpeechText (time mode)", () => {
  it("includes minute range", () => {
    expect(
      buildSpeechText({
        kind: "time",
        partIndex: 0,
        podcastTitle: "My Podcast",
        startSec: 0,
        endSec: 375,
      }),
    ).toBe("Part 1 of My Podcast. Minutes 0 to 6");
  });

  it("floors minute values", () => {
    expect(
      buildSpeechText({
        kind: "time",
        partIndex: 1,
        podcastTitle: "Show",
        startSec: 375,
        endSec: 750,
      }),
    ).toBe("Part 2 of Show. Minutes 6 to 12");
  });

  it("handles later parts", () => {
    expect(
      buildSpeechText({
        kind: "time",
        partIndex: 12,
        podcastTitle: "Show",
        startSec: 4500,
        endSec: 4831,
      }),
    ).toBe("Part 13 of Show. Minutes 75 to 80");
  });
});

describe("buildSpeechText (chapter mode, un-subdivided)", () => {
  it("announces chapter number (not global part index) and title", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        chapterNumber: 1,
        podcastTitle: "My Show",
        chapterTitle: "Introduction",
      }),
    ).toBe("Chapter 1 of My Show. Introduction");
  });

  it("uses chapterNumber verbatim (not partIndex + 1)", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        chapterNumber: 5,
        podcastTitle: "Show",
        chapterTitle: "Fifth topic",
      }),
    ).toBe("Chapter 5 of Show. Fifth topic");
  });

  it("falls back to just the header when chapter title is empty", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        chapterNumber: 1,
        podcastTitle: "Show",
        chapterTitle: "",
      }),
    ).toBe("Chapter 1 of Show");
  });

  it("falls back when chapter title is only whitespace", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        chapterNumber: 3,
        podcastTitle: "Show",
        chapterTitle: "   ",
      }),
    ).toBe("Chapter 3 of Show");
  });

  it("trims whitespace around chapter titles", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        chapterNumber: 1,
        podcastTitle: "Show",
        chapterTitle: "  Topic  ",
      }),
    ).toBe("Chapter 1 of Show. Topic");
  });
});

describe("buildSpeechText (chapter mode, subdivided)", () => {
  it("sub-part 1 of K includes chapter title and 'part 1 of K'", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        chapterNumber: 3,
        podcastTitle: "My Show",
        chapterTitle: "The Real Story",
        subPart: { index: 1, count: 4 },
      }),
    ).toBe("Chapter 3 of My Show. The Real Story, part 1 of 4");
  });

  it("sub-part 2+ drops the chapter title, keeps 'part M of K'", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        chapterNumber: 3,
        podcastTitle: "My Show",
        chapterTitle: "The Real Story",
        subPart: { index: 2, count: 4 },
      }),
    ).toBe("Chapter 3 of My Show, part 2 of 4");
  });

  it("sub-part N of N announces the final sub-part", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        chapterNumber: 3,
        podcastTitle: "My Show",
        chapterTitle: "The Real Story",
        subPart: { index: 4, count: 4 },
      }),
    ).toBe("Chapter 3 of My Show, part 4 of 4");
  });

  it("sub-part 1 with empty chapter title still announces the part counter", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        chapterNumber: 2,
        podcastTitle: "Show",
        chapterTitle: "",
        subPart: { index: 1, count: 3 },
      }),
    ).toBe("Chapter 2 of Show, part 1 of 3");
  });
});
