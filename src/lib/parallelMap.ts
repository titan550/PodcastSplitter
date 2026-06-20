/**
 * Work-stealing pool with strictly-ordered result delivery.
 *
 * Each worker repeatedly claims the next index from a shared cursor and runs
 * `process(worker, index)`. Results are passed to `onResult` in ascending
 * index order even though `process` may finish them in any order — a
 * promise-chain mutex serializes delivery so two workers can't advance the
 * delivery cursor at once.
 *
 * Errors are NOT swallowed: a throw from `process` or `onResult` rejects the
 * whole call so the caller's try/catch can abort. This matters for the ZIP
 * writer — a failed ordered append leaves the archive corrupt, so the failure
 * must surface rather than let later appends silently continue.
 */
export async function runOrderedPool<W, R>(
  workers: W[],
  itemCount: number,
  process: (worker: W, index: number) => Promise<R>,
  onResult: (index: number, result: R) => Promise<void>,
): Promise<void> {
  const ready = new Map<number, R>();
  let nextDeliver = 0;
  let cursor = 0;
  let aborted = false;
  let firstError: unknown;
  let deliverChain: Promise<void> = Promise.resolve();

  // First failure wins: record it and stop every worker from claiming new work.
  const abort = (err: unknown): void => {
    if (!aborted) {
      aborted = true;
      firstError = err;
    }
  };

  const deliverReady = (): Promise<void> => {
    deliverChain = deliverChain.then(async () => {
      while (ready.has(nextDeliver)) {
        const result = ready.get(nextDeliver)!;
        ready.delete(nextDeliver);
        await onResult(nextDeliver, result);
        nextDeliver++;
      }
    });
    return deliverChain;
  };

  const runWorker = async (worker: W): Promise<void> => {
    while (!aborted) {
      const index = cursor++;
      if (index >= itemCount) return;
      try {
        ready.set(index, await process(worker, index));
        await deliverReady();
      } catch (err) {
        // Catch per-worker so each settles its own deliverChain; a sibling
        // chaining onto a rejected chain would orphan an unhandledrejection.
        abort(err);
        return;
      }
    }
  };

  await Promise.all(workers.map(runWorker));
  if (aborted) throw firstError;
}
