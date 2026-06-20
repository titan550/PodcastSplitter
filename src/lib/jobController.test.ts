import { describe, it, expect } from "vitest";
import { JobController, type StartJobPayload } from "./jobController";
import type {
  ErrorPayload,
  ProgressPayload,
  RuntimeCapabilities,
  WorkerInMessage,
  WorkerOutMessage,
} from "../types";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Minimal stand-in for a Worker that records posts and lets a test push
 *  messages back as if the worker had emitted them. */
class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerOutMessage>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: WorkerInMessage[] = [];
  terminated = false;

  postMessage(msg: WorkerInMessage) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(msg: WorkerOutMessage) {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerOutMessage>);
  }
}

interface Harness {
  controller: JobController;
  workers: FakeWorker[];
  progress: ProgressPayload[];
  complete: Blob[];
  errors: ErrorPayload[];
  caps: RuntimeCapabilities[];
}

function setup(synthesize?: (text: string) => Promise<Blob>): Harness {
  const workers: FakeWorker[] = [];
  const progress: ProgressPayload[] = [];
  const complete: Blob[] = [];
  const errors: ErrorPayload[] = [];
  const caps: RuntimeCapabilities[] = [];
  const controller = new JobController({
    onProgress: (p) => progress.push(p),
    onComplete: (b) => complete.push(b),
    onError: (e) => errors.push(e),
    onCapabilities: (c) => caps.push(c),
    synthesize: synthesize ?? (async () => new Blob(["wav"])),
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    },
  });
  return { controller, workers, progress, complete, errors, caps };
}

const STUB_JOB = { marker: 1 } as unknown as StartJobPayload;

describe("JobController", () => {
  it("spawns a worker on construction", () => {
    const { workers } = setup();
    expect(workers).toHaveLength(1);
  });

  it("start() posts START_JOB to the current worker", () => {
    const { controller, workers } = setup();
    controller.start(STUB_JOB);
    expect(workers[0]!.posted).toEqual([
      { type: "START_JOB", payload: STUB_JOB },
    ]);
  });

  it("synthesizes a REQUEST_TTS and posts the result back with the same id", async () => {
    const blob = new Blob(["audio"]);
    const texts: string[] = [];
    const { workers } = setup(async (t) => {
      texts.push(t);
      return blob;
    });
    workers[0]!.emit({ type: "REQUEST_TTS", payload: { id: 7, text: "hello" } });
    await tick();
    expect(texts).toEqual(["hello"]);
    expect(workers[0]!.posted).toContainEqual({
      type: "TTS_RESULT",
      payload: { id: 7, wavBlob: blob },
    });
  });

  it("drains queued TTS requests serially, in order", async () => {
    const order: number[] = [];
    const { workers } = setup(async (t) => {
      order.push(Number(t));
      await tick();
      return new Blob([t]);
    });
    for (let id = 0; id < 4; id++) {
      workers[0]!.emit({ type: "REQUEST_TTS", payload: { id, text: String(id) } });
    }
    await tick();
    await tick();
    await tick();
    await tick();
    expect(order).toEqual([0, 1, 2, 3]);
    expect(workers[0]!.posted.filter((m) => m.type === "TTS_RESULT")).toHaveLength(4);
  });

  it("drops a stale TTS result after the worker is recreated", async () => {
    let resolveSynth!: (b: Blob) => void;
    const { controller, workers } = setup(
      () => new Promise<Blob>((res) => (resolveSynth = res)),
    );
    workers[0]!.emit({ type: "REQUEST_TTS", payload: { id: 1, text: "a" } });
    await tick(); // synthesis is now in flight for worker 0

    controller.cancel(); // terminate worker 0, spawn worker 1
    resolveSynth(new Blob(["late"])); // old synthesis finally resolves
    await tick();

    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    // Neither the dead worker nor its replacement receives the stale blob.
    expect(workers[0]!.posted.filter((m) => m.type === "TTS_RESULT")).toEqual([]);
    expect(workers[1]!.posted.filter((m) => m.type === "TTS_RESULT")).toEqual([]);
  });

  it("routes PROGRESS, COMPLETE, and CAPABILITIES to callbacks", () => {
    const { workers, progress, complete, caps } = setup();
    const p: ProgressPayload = { phase: "encoding", pct: 50, overallPct: 40 };
    const zip = new Blob(["zip"]);
    const c = { crossOriginIsolated: true } as RuntimeCapabilities;
    workers[0]!.emit({ type: "PROGRESS", payload: p });
    workers[0]!.emit({ type: "COMPLETE", payload: { zipBlob: zip } });
    workers[0]!.emit({ type: "CAPABILITIES", payload: c });
    expect(progress).toEqual([p]);
    expect(complete).toEqual([zip]);
    expect(caps).toEqual([c]);
  });

  it("reports a worker ERROR and recreates the worker", () => {
    const { workers, errors } = setup();
    const payload: ErrorPayload = {
      message: "boom",
      phase: "encoding",
      recoverable: false,
    };
    workers[0]!.emit({ type: "ERROR", payload });
    expect(errors).toEqual([payload]);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });

  it("reports a synthesis failure as a tts error and recreates the worker", async () => {
    const { workers, errors } = setup(async () => {
      throw new Error("synth fail");
    });
    workers[0]!.emit({ type: "REQUEST_TTS", payload: { id: 1, text: "a" } });
    await tick();
    expect(errors).toContainEqual({
      message: "synth fail",
      phase: "tts",
      recoverable: false,
    });
    expect(workers).toHaveLength(2);
  });

  it("drops a stale synthesis failure after the worker is recreated", async () => {
    let rejectSynth!: (e: unknown) => void;
    const { controller, workers, errors } = setup(
      () => new Promise<Blob>((_res, rej) => (rejectSynth = rej)),
    );
    workers[0]!.emit({ type: "REQUEST_TTS", payload: { id: 1, text: "a" } });
    await tick(); // synthesis is now in flight for worker 0

    controller.cancel(); // terminate worker 0, spawn worker 1
    rejectSynth(new Error("late failure")); // old synthesis rejects after cancel
    await tick();

    // The stale failure belongs to a job the user already cancelled: it must
    // not surface as an error (which would clobber the reset state) nor spawn
    // a third worker.
    expect(errors).toEqual([]);
    expect(workers).toHaveLength(2);
  });

  it("dispose() terminates the worker without spawning a replacement", () => {
    const { controller, workers } = setup();
    controller.dispose();
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(1);
  });
});
