import { describe, it, expect } from "vitest";
import { runOrderedPool } from "./parallelMap";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("runOrderedPool", () => {
  it("delivers results in ascending index order despite out-of-order completion", async () => {
    const itemCount = 4;
    const delivered: number[] = [];
    await runOrderedPool(
      range(itemCount), // one worker per item → all start concurrently
      itemCount,
      // Higher indices finish first, so completion order is the reverse of
      // delivery order.
      async (_w, i) => {
        await tick((itemCount - i) * 5);
        return i * 10;
      },
      async (i, result) => {
        expect(result).toBe(i * 10);
        delivered.push(i);
      },
    );
    expect(delivered).toEqual([0, 1, 2, 3]);
  });

  it("processes every item exactly once when workers < items (work-stealing)", async () => {
    const itemCount = 20;
    const processed: number[] = [];
    const delivered: number[] = [];
    await runOrderedPool(
      [0, 1, 2],
      itemCount,
      async (_w, i) => {
        await tick(i % 3);
        processed.push(i);
        return i;
      },
      async (i) => {
        delivered.push(i);
      },
    );
    expect([...processed].sort((a, b) => a - b)).toEqual(range(itemCount));
    expect(delivered).toEqual(range(itemCount));
  });

  it("never delivers an index before its predecessor", async () => {
    const itemCount = 10;
    let lastDelivered = -1;
    await runOrderedPool(
      [0, 1, 2, 3],
      itemCount,
      async (_w, i) => {
        await tick((i * 7) % 5);
        return i;
      },
      async (i) => {
        expect(i).toBe(lastDelivered + 1);
        lastDelivered = i;
      },
    );
    expect(lastDelivered).toBe(itemCount - 1);
  });

  it("does nothing when itemCount is 0", async () => {
    let processCalls = 0;
    let resultCalls = 0;
    await runOrderedPool(
      [0, 1],
      0,
      async () => {
        processCalls++;
        return null;
      },
      async () => {
        resultCalls++;
      },
    );
    expect(processCalls).toBe(0);
    expect(resultCalls).toBe(0);
  });

  it("propagates errors thrown by process", async () => {
    await expect(
      runOrderedPool(
        [0], // single worker → deterministic
        4,
        async (_w, i) => {
          if (i === 2) throw new Error("boom");
          return i;
        },
        async () => {},
      ),
    ).rejects.toThrow("boom");
  });

  it("propagates errors thrown by onResult", async () => {
    await expect(
      runOrderedPool(
        [0],
        3,
        async (_w, i) => i,
        async (i) => {
          if (i === 1) throw new Error("zip failed");
        },
      ),
    ).rejects.toThrow("zip failed");
  });

  it("stops sibling workers from claiming new work after a failure", async () => {
    const itemCount = 12;
    const started: number[] = [];
    let failed = false;
    try {
      await runOrderedPool(
        [0, 1], // two workers run concurrently
        itemCount,
        async (_w, i) => {
          started.push(i);
          if (i === 1) throw new Error("boom"); // second worker fails fast
          await tick(5);
          return i;
        },
        async () => {},
      );
    } catch {
      failed = true;
    }
    // Give any (incorrectly) surviving worker ample time to keep claiming.
    await tick(50);
    expect(failed).toBe(true);
    // The pool aborted: it must not have run all 12 items to completion.
    expect(started.length).toBeLessThan(itemCount);
  });
});
