import { describe, it, expect } from "vitest";
import { buildEndSpeechText, buildSpeechText } from "./speechText";

describe("buildSpeechText (time mode)", () => {
  it("leads with the global part counter and appends the minute range", () => {
    expect(
      buildSpeechText({
        kind: "time",
        partIndex: 0,
        totalParts: 9,
        podcastTitle: "My Podcast",
        startSec: 0,
        endSec: 375,
      }),
    ).toBe("Part 1 of 9. My Podcast. Minutes 0 to 6.");
  });

  it("floors minute values", () => {
    expect(
      buildSpeechText({
        kind: "time",
        partIndex: 1,
        totalParts: 5,
        podcastTitle: "Show",
        startSec: 375,
        endSec: 750,
      }),
    ).toBe("Part 2 of 5. Show. Minutes 6 to 12.");
  });

  it("handles later parts", () => {
    expect(
      buildSpeechText({
        kind: "time",
        partIndex: 12,
        totalParts: 13,
        podcastTitle: "Show",
        startSec: 4500,
        endSec: 4831,
      }),
    ).toBe("Part 13 of 13. Show. Minutes 75 to 80.");
  });
});

describe("buildSpeechText (chapter mode, un-subdivided)", () => {
  it("leads with Part N of TOTAL, then adds podcast + chapter counter + title", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 0,
        totalParts: 3,
        chapterNumber: 1,
        totalChapters: 3,
        podcastTitle: "My Show",
        chapterTitle: "Introduction",
      }),
    ).toBe("Part 1 of 3. My Show. Chapter 1 of 3. Introduction.");
  });

  it("uses chapterNumber verbatim (not partIndex + 1)", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 4,
        totalParts: 7,
        chapterNumber: 5,
        totalChapters: 7,
        podcastTitle: "Show",
        chapterTitle: "Fifth topic",
      }),
    ).toBe("Part 5 of 7. Show. Chapter 5 of 7. Fifth topic.");
  });

  it("falls back to just the header when chapter title is empty", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 0,
        totalParts: 2,
        chapterNumber: 1,
        totalChapters: 2,
        podcastTitle: "Show",
        chapterTitle: "",
      }),
    ).toBe("Part 1 of 2. Show. Chapter 1 of 2.");
  });

  it("falls back when chapter title is only whitespace", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 2,
        totalParts: 4,
        chapterNumber: 3,
        totalChapters: 4,
        podcastTitle: "Show",
        chapterTitle: "   ",
      }),
    ).toBe("Part 3 of 4. Show. Chapter 3 of 4.");
  });

  it("trims whitespace around chapter titles", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 0,
        totalParts: 2,
        chapterNumber: 1,
        totalChapters: 2,
        podcastTitle: "Show",
        chapterTitle: "  Topic  ",
      }),
    ).toBe("Part 1 of 2. Show. Chapter 1 of 2. Topic.");
  });
});

describe("buildSpeechText (chapter mode, subdivided)", () => {
  it("sub-part 1 of K includes chapter title and 'segment 1 of K'", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 2,
        totalParts: 10,
        chapterNumber: 3,
        totalChapters: 5,
        podcastTitle: "My Show",
        chapterTitle: "The Real Story",
        subPart: { index: 1, count: 4 },
      }),
    ).toBe("Part 3 of 10. My Show. Chapter 3 of 5. The Real Story, segment 1 of 4.");
  });

  it("sub-part 2+ drops the chapter title, keeps 'segment M of K'", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 3,
        totalParts: 10,
        chapterNumber: 3,
        totalChapters: 5,
        podcastTitle: "My Show",
        chapterTitle: "The Real Story",
        subPart: { index: 2, count: 4 },
      }),
    ).toBe("Part 4 of 10. My Show. Chapter 3 of 5, segment 2 of 4.");
  });

  it("sub-part N of N announces the final sub-part", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 5,
        totalParts: 10,
        chapterNumber: 3,
        totalChapters: 5,
        podcastTitle: "My Show",
        chapterTitle: "The Real Story",
        subPart: { index: 4, count: 4 },
      }),
    ).toBe("Part 6 of 10. My Show. Chapter 3 of 5, segment 4 of 4.");
  });

  it("sub-part 1 with empty chapter title still announces the part counter", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 1,
        totalParts: 6,
        chapterNumber: 2,
        totalChapters: 4,
        podcastTitle: "Show",
        chapterTitle: "",
        subPart: { index: 1, count: 3 },
      }),
    ).toBe("Part 2 of 6. Show. Chapter 2 of 4, segment 1 of 3.");
  });
});

describe("buildEndSpeechText", () => {
  it("uses 1-based part counter", () => {
    expect(buildEndSpeechText(0, 4)).toBe("End of part 1 of 4.");
    expect(buildEndSpeechText(3, 4)).toBe("End of part 4 of 4.");
  });
});
