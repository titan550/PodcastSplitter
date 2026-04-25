import { describe, it, expect } from "vitest";
import {
  anyChapterWillSubdivide,
  findBestCut,
  planCuts,
  planCutsByCount,
  planCutsFromChapters,
} from "./cutPlanner";
import type { Chapter, SilenceInterval } from "../types";

// Keep assertions terse: default target = 300, speed = 1, no silences.
// Individual tests override when they need subdivision or snapping.
const plan = (
  chapters: Chapter[],
  total: number,
  target = 300,
  speed = 1,
  silences: SilenceInterval[] = [],
) => planCutsFromChapters(chapters, total, target, speed, silences);

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
    expect(plan([], 1000)).toEqual([]);
  });

  it("converts ordered chapters to ordered cuts and carries chapter info", () => {
    const cuts = plan(
      [
        { title: "One", start: 0 },
        { title: "Two", start: 100 },
        { title: "Three", start: 250 },
      ],
      400,
    );
    expect(cuts).toEqual([
      {
        startSec: 0,
        endSec: 100,
        partIndex: 0,
        chapter: { title: "One", number: 1, totalChapters: 3 },
      },
      {
        startSec: 100,
        endSec: 250,
        partIndex: 1,
        chapter: { title: "Two", number: 2, totalChapters: 3 },
      },
      {
        startSec: 250,
        endSec: 400,
        partIndex: 2,
        chapter: { title: "Three", number: 3, totalChapters: 3 },
      },
    ]);
  });

  it("un-subdivided chapters have no chapter.part field", () => {
    const cuts = plan([{ title: "Short", start: 0 }], 120);
    expect(cuts[0]!.chapter?.part).toBeUndefined();
  });

  it("sorts out-of-order chapters by start", () => {
    const cuts = plan(
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
    // Pass a very large target so Main doesn't subdivide — this test is
    // about the Intro prepend behavior, not about subdivision.
    const cuts = plan(
      [
        { title: "Main", start: 30 },
        { title: "Outro", start: 900 },
      ],
      1000,
      100000,
    );
    expect(cuts).toHaveLength(3);
    expect(cuts[0]).toEqual({
      startSec: 0,
      endSec: 30,
      partIndex: 0,
      chapter: { title: "Intro", number: 1, totalChapters: 3 },
    });
    expect(cuts[1]!.startSec).toBe(30);
    expect(cuts[1]!.chapter?.title).toBe("Main");
    expect(cuts[1]!.chapter?.number).toBe(2);
  });

  it("does NOT prepend Intro when first chapter starts at 0 or within 1s", () => {
    const a = plan([{ title: "A", start: 0 }], 100);
    expect(a).toHaveLength(1);
    expect(a[0]!.startSec).toBe(0);

    const b = plan([{ title: "B", start: 0.5 }], 100);
    expect(b).toHaveLength(1);
    expect(b[0]!.startSec).toBe(0.5);
  });

  it("closes gaps by using next chapter's start as current's end", () => {
    const cuts = plan(
      [
        { title: "A", start: 0 },
        { title: "B", start: 50 },
      ],
      100,
    );
    expect(cuts[0]!.endSec).toBe(50);
    expect(cuts[1]!.endSec).toBe(100);
  });

  it("drops zero-length trailing chapter at exact file end and excludes it from totalChapters", () => {
    const cuts = plan(
      [
        { title: "A", start: 0 },
        { title: "B", start: 100 },
      ],
      100,
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.chapter?.totalChapters).toBe(1);
    expect(cuts[0]!.chapter?.number).toBe(1);
  });

  it("assigns contiguous partIndex after sort + intro prepend", () => {
    const cuts = plan(
      [
        { title: "Later", start: 60 },
        { title: "Earlier", start: 20 },
      ],
      120,
    );
    expect(cuts.map((c) => c.partIndex)).toEqual([0, 1, 2]);
  });

  // --- Subdivision ---

  it("subdivides a long chapter into multiple sub-parts", () => {
    // One 900 s chapter, target 300 s → 3 sub-parts of 300 s each.
    const cuts = plan([{ title: "Long", start: 0 }], 900, 300);
    expect(cuts).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(cuts[i]!.chapter?.number).toBe(1);
      expect(cuts[i]!.chapter?.totalChapters).toBe(1);
      expect(cuts[i]!.chapter?.title).toBe("Long");
      expect(cuts[i]!.chapter?.part).toEqual({ index: i + 1, count: 3 });
      expect(cuts[i]!.partIndex).toBe(i);
    }
    expect(cuts.map((c) => [c.startSec, c.endSec])).toEqual([
      [0, 300],
      [300, 600],
      [600, 900],
    ]);
  });

  it("10% tolerance: chapter 5% over target stays one part", () => {
    const cuts = plan([{ title: "Barely", start: 0 }], 315, 300);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.chapter?.part).toBeUndefined();
  });

  it("10% tolerance: chapter 20% over target subdivides", () => {
    const cuts = plan([{ title: "Over", start: 0 }], 360, 300);
    expect(cuts.length).toBeGreaterThan(1);
    expect(cuts[0]!.chapter?.part?.count).toBe(cuts.length);
  });

  it("sub-part boundaries snap to silences inside the chapter window", () => {
    // Single long chapter at 0, spanning 0–900 (900 s), target 300 s.
    // Silence at 295–297 (inside the window) should snap the first
    // sub-cut to midpoint 296. A silence at 50–52 (outside the grace
    // window of ±20 s around 300) must be ignored.
    const silences: SilenceInterval[] = [
      { start: 50, end: 52 },
      { start: 295, end: 297 },
    ];
    const cuts = plan([{ title: "Long", start: 0 }], 900, 300, 1, silences);
    expect(cuts.length).toBeGreaterThan(1);
    expect(cuts[0]!.startSec).toBe(0);
    expect(cuts[0]!.endSec).toBe(296);
  });

  it("mixed chapters: short + long + short produces 1 + K + 1 cuts with stable chapter number", () => {
    // Chapter 1: 0–200 (short)
    // Chapter 2: 200–1100 (long, 900 s → 3 sub-parts)
    // Chapter 3: 1100–1300 (short)
    const cuts = plan(
      [
        { title: "A", start: 0 },
        { title: "B", start: 200 },
        { title: "C", start: 1100 },
      ],
      1300,
      300,
    );
    expect(cuts).toHaveLength(1 + 3 + 1);
    expect(cuts.map((c) => c.chapter?.number)).toEqual([1, 2, 2, 2, 3]);
    for (const c of cuts) expect(c.chapter?.totalChapters).toBe(3);
    expect(cuts.map((c) => c.partIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(cuts[0]!.chapter?.part).toBeUndefined();
    expect(cuts[1]!.chapter?.part?.count).toBe(3);
    expect(cuts[4]!.chapter?.part).toBeUndefined();
  });

  it("subdivides the synthetic Intro when it exceeds the ceiling", () => {
    // First real chapter at 1200 s → Intro is 0–1200, 900 s over target.
    const cuts = plan(
      [
        { title: "Main", start: 1200 },
        { title: "Outro", start: 1500 },
      ],
      1600,
      300,
    );
    const introCuts = cuts.filter((c) => c.chapter?.number === 1);
    expect(introCuts.length).toBe(4);
    for (const c of introCuts) {
      expect(c.chapter?.title).toBe("Intro");
      expect(c.chapter?.part?.count).toBe(4);
    }
  });

  it("speed-adjusted output duration drives the subdivision decision", () => {
    // 400 s chapter at 1.5x → output duration 266.67 s, well under target 300.
    const cuts = plan([{ title: "Fast", start: 0 }], 400, 300, 1.5);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.chapter?.part).toBeUndefined();
  });

  it("subdivide=false keeps long chapters as one part", () => {
    // 900 s chapter would normally split into 3, but with subdivide=false
    // it stays as one part.
    const cuts = planCutsFromChapters(
      [{ title: "Long", start: 0 }],
      900,
      300,
      1,
      [],
      false,
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.chapter?.part).toBeUndefined();
  });

  it("subdivides a 14-min chapter at 10-min target (covers 1.10 ceiling boundary)", () => {
    // 840 s output > 660 s ceiling (= 600 * 1.10) → subdivides.
    const cuts = planCutsFromChapters(
      [{ title: "Long", start: 0 }],
      14 * 60,
      10 * 60,
      1,
      [],
      true,
    );
    expect(cuts.length).toBeGreaterThan(1);
  });
});

describe("findBestCut", () => {
  it("returns the ideal when no silences in window", () => {
    expect(findBestCut(300, [])).toBe(300);
    expect(findBestCut(300, [{ start: 10, end: 12 }])).toBe(300);
  });

  it("snaps to midpoint of a silence fully inside the window", () => {
    expect(findBestCut(300, [{ start: 295, end: 297 }])).toBe(296);
  });

  it("clamps when a long silence straddles windowEnd (regression)", () => {
    // silence [319, 340] overlaps the window [280, 320] but its raw
    // midpoint (329.5) is outside the window. The fix intersects the
    // silence with the window first, so the returned cut stays inside.
    const cut = findBestCut(300, [{ start: 319, end: 340 }]);
    expect(cut).toBeGreaterThanOrEqual(280);
    expect(cut).toBeLessThanOrEqual(320);
    // Intersection is [319, 320]; midpoint 319.5.
    expect(cut).toBeCloseTo(319.5, 5);
  });

  it("clamps when a long silence straddles windowStart", () => {
    // silence [260, 340] overlaps the window; intersection is the
    // entire window [280, 320]; midpoint is the ideal.
    const cut = findBestCut(300, [{ start: 260, end: 340 }]);
    expect(cut).toBe(300);
  });

  it("respects a custom graceSec", () => {
    // With grace=5, silence [280, 282] is outside the tight window [295, 305].
    expect(findBestCut(300, [{ start: 280, end: 282 }], 5)).toBe(300);
    expect(findBestCut(300, [{ start: 298, end: 302 }], 5)).toBe(300);
  });
});

describe("anyChapterWillSubdivide", () => {
  it("returns false when subdivide=false regardless of chapter length", () => {
    expect(
      anyChapterWillSubdivide(
        [{ title: "Long", start: 0 }],
        900,
        300,
        1,
        false,
      ),
    ).toBe(false);
  });
});

describe("planCutsByCount", () => {
  it("produces exactly N equal segments with no silences", () => {
    const cuts = planCutsByCount(1000, 5, []);
    expect(cuts).toHaveLength(5);
    expect(cuts.map((c) => [c.startSec, c.endSec])).toEqual([
      [0, 200],
      [200, 400],
      [400, 600],
      [600, 800],
      [800, 1000],
    ]);
    cuts.forEach((c, i) => expect(c.partIndex).toBe(i));
  });

  it("N=1 returns a single segment covering the full duration", () => {
    expect(planCutsByCount(500, 1, [])).toEqual([
      { startSec: 0, endSec: 500, partIndex: 0 },
    ]);
  });

  it("N=0 treated as single segment", () => {
    const cuts = planCutsByCount(500, 0, []);
    expect(cuts).toHaveLength(1);
  });

  it("snaps boundaries to silences within the (scaled) grace window", () => {
    // total=1000, N=5 → segLen=200, graceWindow=min(20, 60) = 20.
    // Silence at 198-200 is inside the window around the first cut (200).
    const cuts = planCutsByCount(1000, 5, [{ start: 198, end: 200 }]);
    expect(cuts).toHaveLength(5);
    expect(cuts[0]!.endSec).toBe(199);
    expect(cuts[1]!.startSec).toBe(199);
  });

  it("silence straddling a boundary never produces a cut outside its window", () => {
    // Would previously have returned a cut far past the segment boundary.
    const cuts = planCutsByCount(1000, 5, [{ start: 215, end: 260 }]);
    expect(cuts).toHaveLength(5);
    expect(cuts[0]!.endSec).toBeLessThanOrEqual(220);
  });

  it("does not merge the trailing segment (count is the contract)", () => {
    // 305 / 3 ≈ 101.67 — no silence pressure; exact-count contract.
    const cuts = planCutsByCount(305, 3, []);
    expect(cuts).toHaveLength(3);
  });

  it("produces strictly monotonic, gap-free, covering cuts", () => {
    const cuts = planCutsByCount(
      1000,
      5,
      [
        { start: 190, end: 220 }, // straddles 200
        { start: 390, end: 420 }, // straddles 400
        { start: 790, end: 820 }, // straddles 800
      ],
    );
    expect(cuts).toHaveLength(5);
    expect(cuts[0]!.startSec).toBe(0);
    expect(cuts[cuts.length - 1]!.endSec).toBe(1000);
    for (let i = 1; i < cuts.length; i++) {
      expect(cuts[i]!.startSec).toBe(cuts[i - 1]!.endSec);
      expect(cuts[i]!.startSec).toBeGreaterThan(cuts[i - 1]!.startSec);
    }
  });

  it("grace window scales with segment length so windows cannot overlap", () => {
    // segLen=40 → graceWindow=12 (30% of 40). A silence that would reach
    // past a scaled window cap must not pull cut 1 into cut 2's territory.
    const cuts = planCutsByCount(200, 5, [{ start: 38, end: 90 }]);
    expect(cuts).toHaveLength(5);
    expect(cuts[0]!.endSec).toBeLessThan(cuts[1]!.endSec);
    expect(cuts[0]!.endSec).toBeLessThanOrEqual(52); // ideal (40) + grace cap (12)
  });
});
