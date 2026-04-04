import { describe, it, expect } from "vitest";
import { buildSpeechText } from "./speechText";

describe("buildSpeechText", () => {
  it("formats part 1 without times", () => {
    expect(buildSpeechText(0, "My Podcast")).toBe("Part 1 of My Podcast");
  });

  it("formats part 5 without times", () => {
    expect(buildSpeechText(4, "The Daily")).toBe("Part 5 of The Daily");
  });

  it("handles empty title without times", () => {
    expect(buildSpeechText(0, "")).toBe("Part 1 of ");
  });

  it("includes minute range when times provided", () => {
    expect(buildSpeechText(0, "My Podcast", 0, 375)).toBe(
      "Part 1 of My Podcast. Minutes 0 to 6",
    );
  });

  it("floors minute values", () => {
    // 375s = 6.25 min → 6, 750s = 12.5 min → 12
    expect(buildSpeechText(1, "Show", 375, 750)).toBe(
      "Part 2 of Show. Minutes 6 to 12",
    );
  });

  it("handles last part ending at exact minute", () => {
    expect(buildSpeechText(12, "Show", 4500, 4831)).toBe(
      "Part 13 of Show. Minutes 75 to 80",
    );
  });

  it("omits times if only one is provided", () => {
    expect(buildSpeechText(0, "Show", 0)).toBe("Part 1 of Show");
    expect(buildSpeechText(0, "Show", undefined, 100)).toBe("Part 1 of Show");
  });
});
