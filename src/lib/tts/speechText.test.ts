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

describe("buildSpeechText (chapter mode)", () => {
  it("announces chapter index and title", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 0,
        podcastTitle: "My Show",
        chapterTitle: "Introduction",
      }),
    ).toBe("Chapter 1 of My Show. Introduction");
  });

  it("increments part index by 1", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 4,
        podcastTitle: "Show",
        chapterTitle: "Fifth topic",
      }),
    ).toBe("Chapter 5 of Show. Fifth topic");
  });

  it("falls back to just the header when chapter title is empty", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 0,
        podcastTitle: "Show",
        chapterTitle: "",
      }),
    ).toBe("Chapter 1 of Show");
  });

  it("falls back when chapter title is only whitespace", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 2,
        podcastTitle: "Show",
        chapterTitle: "   ",
      }),
    ).toBe("Chapter 3 of Show");
  });

  it("trims whitespace around chapter titles", () => {
    expect(
      buildSpeechText({
        kind: "chapter",
        partIndex: 0,
        podcastTitle: "Show",
        chapterTitle: "  Topic  ",
      }),
    ).toBe("Chapter 1 of Show. Topic");
  });
});
