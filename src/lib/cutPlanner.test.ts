import { describe, it, expect } from "vitest";
import { planCuts, planCutsFromChapters } from "./cutPlanner";

describe("planCuts", () => {
  it("creates uniform cuts when no silences", () => {
    const cuts = planCuts(600, 300, 1.0, []);
    expect(cuts).toHaveLength(2);
    expect(cuts[0]).toEqual({ startSec: 0, endSec: 300, partIndex: 0 });
    expect(cuts[1]).toEqual({ startSec: 300, endSec: 600, partIndex: 1 });
  });

  it("accounts for playback speed in source duration", () => {
    // At 1.25x, 5 min output = 6.25 min source
    const cuts = planCuts(750, 300, 1.25, []);
    expect(cuts).toHaveLength(2);
    expect(cuts[0]!.endSec).toBe(375); // 300 * 1.25
  });

  it("snaps to silence near ideal cut point", () => {
    const silences = [{ start: 290, end: 292 }];
    const cuts = planCuts(600, 300, 1.0, silences);
    expect(cuts[0]!.endSec).toBe(291); // midpoint of silence
  });

  it("prefers closer silence to ideal cut", () => {
    const silences = [
      { start: 280, end: 282 }, // 20 away
      { start: 298, end: 300 }, // 1 away
    ];
    const cuts = planCuts(600, 300, 1.0, silences);
    expect(cuts[0]!.endSec).toBe(299); // midpoint of closer silence
  });

  it("uses exact boundary when no silence in window", () => {
    const silences = [{ start: 10, end: 12 }]; // far from 300
    const cuts = planCuts(600, 300, 1.0, silences);
    expect(cuts[0]!.endSec).toBe(300);
  });

  it("handles last part shorter than target", () => {
    const cuts = planCuts(400, 300, 1.0, []);
    expect(cuts).toHaveLength(2);
    expect(cuts[1]!.endSec).toBe(400);
  });

  it("merges trailing segment if too short", () => {
    // Total 310 at speed 1.0: would make parts of 300 and 10
    // 10s < 30s minimum, so merged into one part
    const cuts = planCuts(310, 300, 1.0, []);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.endSec).toBe(310);
  });

  it("keeps trailing segment if long enough", () => {
    // Total 350: parts of 300 and 50. 50s > 30s, so kept
    const cuts = planCuts(350, 300, 1.0, []);
    expect(cuts).toHaveLength(2);
  });

  it("handles single part when total <= target", () => {
    const cuts = planCuts(200, 300, 1.0, []);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toEqual({ startSec: 0, endSec: 200, partIndex: 0 });
  });

  it("produces ordered, non-overlapping cuts covering full duration", () => {
    const silences = [
      { start: 50, end: 52 },
      { start: 150, end: 153 },
      { start: 290, end: 295 },
      { start: 600, end: 603 },
    ];
    const cuts = planCuts(900, 300, 1.0, silences);

    // Check ordering and no gaps
    for (let i = 0; i < cuts.length; i++) {
      expect(cuts[i]!.partIndex).toBe(i);
      if (i > 0) {
        expect(cuts[i]!.startSec).toBe(cuts[i - 1]!.endSec);
      }
    }
    expect(cuts[0]!.startSec).toBe(0);
    expect(cuts[cuts.length - 1]!.endSec).toBe(900);
  });

  it("handles speed-adjusted cuts with silence snapping", () => {
    // At 1.25x, target source per part = 375s
    // Silence at 370-372 is within ±20s window of 375
    const silences = [{ start: 370, end: 372 }];
    const cuts = planCuts(800, 300, 1.25, silences);
    expect(cuts[0]!.endSec).toBe(371); // snapped to silence midpoint
  });
});

describe("planCutsFromChapters", () => {
  it("returns empty for empty input", () => {
    expect(planCutsFromChapters([], 1000)).toEqual([]);
  });

  it("converts ordered chapters to ordered cuts and carries titles", () => {
    const cuts = planCutsFromChapters(
      [
        { title: "One", start: 0 },
        { title: "Two", start: 100 },
        { title: "Three", start: 250 },
      ],
      400,
    );
    expect(cuts).toEqual([
      { startSec: 0, endSec: 100, partIndex: 0, chapterTitle: "One" },
      { startSec: 100, endSec: 250, partIndex: 1, chapterTitle: "Two" },
      { startSec: 250, endSec: 400, partIndex: 2, chapterTitle: "Three" },
    ]);
  });

  it("sorts out-of-order chapters by start", () => {
    const cuts = planCutsFromChapters(
      [
        { title: "Third", start: 200 },
        { title: "First", start: 0 },
        { title: "Second", start: 100 },
      ],
      300,
    );
    expect(cuts.map((c) => c.startSec)).toEqual([0, 100, 200]);
    expect(cuts[cuts.length - 1]!.endSec).toBe(300);
  });

  it("prepends synthetic Intro when first chapter starts > 1s in", () => {
    const cuts = planCutsFromChapters(
      [
        { title: "Main", start: 30 },
        { title: "Outro", start: 900 },
      ],
      1000,
    );
    expect(cuts).toHaveLength(3);
    expect(cuts[0]).toEqual({
      startSec: 0,
      endSec: 30,
      partIndex: 0,
      chapterTitle: "Intro",
    });
    expect(cuts[1]!.startSec).toBe(30);
    expect(cuts[1]!.chapterTitle).toBe("Main");
  });

  it("does NOT prepend Intro when first chapter starts at 0 or within 1s", () => {
    const a = planCutsFromChapters([{ title: "A", start: 0 }], 100);
    expect(a).toHaveLength(1);
    expect(a[0]!.startSec).toBe(0);

    const b = planCutsFromChapters([{ title: "B", start: 0.5 }], 100);
    expect(b).toHaveLength(1);
    expect(b[0]!.startSec).toBe(0.5);
  });

  it("closes gaps by using next chapter's start as current's end", () => {
    // Even if parser reported gaps, planCutsFromChapters derives end
    // from the next chapter's start, so every second is covered.
    const cuts = planCutsFromChapters(
      [
        { title: "A", start: 0 },
        { title: "B", start: 50 },
      ],
      100,
    );
    expect(cuts[0]!.endSec).toBe(50); // no gap
    expect(cuts[1]!.endSec).toBe(100);
  });

  it("drops zero-length trailing chapter at exact file end", () => {
    const cuts = planCutsFromChapters(
      [
        { title: "A", start: 0 },
        { title: "B", start: 100 }, // total is also 100 — zero length
      ],
      100,
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toEqual({
      startSec: 0,
      endSec: 100,
      partIndex: 0,
      chapterTitle: "A",
    });
  });

  it("assigns contiguous partIndex after sort + intro prepend", () => {
    const cuts = planCutsFromChapters(
      [
        { title: "Later", start: 60 },
        { title: "Earlier", start: 20 },
      ],
      120,
    );
    expect(cuts.map((c) => c.partIndex)).toEqual([0, 1, 2]);
  });
});
