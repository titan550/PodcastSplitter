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
  let deliverChain: Promise<void> = Promise.resolve();

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
    while (true) {
      const index = cursor++;
      if (index >= itemCount) return;
      ready.set(index, await process(worker, index));
      await deliverReady();
    }
  };

  await Promise.all(workers.map(runWorker));
}
