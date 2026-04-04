import { describe, it, expect } from "vitest";
import { parseSilenceLog } from "./silenceDetection";

describe("parseSilenceLog", () => {
  it("parses a single silence interval", () => {
    const lines = [
      "[silencedetect @ 0xabc] silence_start: 10.5",
      "[silencedetect @ 0xabc] silence_end: 11.2 | silence_duration: 0.7",
    ];
    expect(parseSilenceLog(lines)).toEqual([{ start: 10.5, end: 11.2 }]);
  });

  it("parses multiple intervals", () => {
    const lines = [
      "[silencedetect @ 0x1] silence_start: 5.0",
      "[silencedetect @ 0x1] silence_end: 6.0 | silence_duration: 1.0",
      "other log line",
      "[silencedetect @ 0x1] silence_start: 100.123",
      "[silencedetect @ 0x1] silence_end: 102.456 | silence_duration: 2.333",
    ];
    expect(parseSilenceLog(lines)).toEqual([
      { start: 5.0, end: 6.0 },
      { start: 100.123, end: 102.456 },
    ]);
  });

  it("returns empty array for no silence lines", () => {
    const lines = [
      "Duration: 00:03:00.00",
      "Stream #0:0: Audio: mp3, 44100 Hz",
    ];
    expect(parseSilenceLog(lines)).toEqual([]);
  });

  it("ignores unmatched silence_start without end", () => {
    const lines = [
      "[silencedetect @ 0x1] silence_start: 5.0",
      // No silence_end follows
    ];
    expect(parseSilenceLog(lines)).toEqual([]);
  });

  it("handles silence at time zero", () => {
    const lines = [
      "[silencedetect @ 0x1] silence_start: 0",
      "[silencedetect @ 0x1] silence_end: 0.5 | silence_duration: 0.5",
    ];
    expect(parseSilenceLog(lines)).toEqual([{ start: 0, end: 0.5 }]);
  });
});
