import type {
  ErrorPayload,
  ProgressPayload,
  RuntimeCapabilities,
  WorkerInMessage,
  WorkerOutMessage,
} from "../types";
import { errorMessage } from "./errorMessage";

export type StartJobPayload = Extract<
  WorkerInMessage,
  { type: "START_JOB" }
>["payload"];

export interface JobControllerOptions {
  onProgress: (payload: ProgressPayload) => void;
  onComplete: (zipBlob: Blob) => void;
  onError: (payload: ErrorPayload) => void;
  onCapabilities: (caps: RuntimeCapabilities) => void;
  // Main-thread TTS synthesis (Piper). A rejection fails the job.
  synthesize: (text: string) => Promise<Blob>;
  // Worker factory; overridable for tests. Defaults to the audio worker.
  createWorker?: () => Worker;
}

function defaultCreateWorker(): Worker {
  return new Worker(new URL("../workers/audioWorker.ts", import.meta.url), {
    type: "module",
  });
}

/**
 * Owns the audio worker's lifecycle and the main-thread ↔ worker TTS relay.
 *
 * The worker fires REQUEST_TTS messages; the controller synthesizes them
 * serially off a queue and posts each TTS_RESULT back, which lets synthesis
 * pipeline against ffmpeg encoding in the worker. Each queued request is
 * tagged with the worker it targets: after a cancel/recreate, in-flight
 * synthesis still completes but its result is dropped unless that worker is
 * still current — otherwise the blob would bind to an unrelated id on the
 * replacement worker (ids restart at 0).
 *
 * On any worker error the controller recreates the worker so the next job
 * starts clean: a failed job leaves unresolved requestTTS promises inside
 * the worker that would otherwise deadlock the next run.
 */
export class JobController {
  private readonly opts: JobControllerOptions;
  private readonly makeWorker: () => Worker;
  private worker: Worker | null = null;
  private queue: Array<{ id: number; text: string; target: Worker }> = [];
  private draining = false;

  constructor(opts: JobControllerOptions) {
    this.opts = opts;
    this.makeWorker = opts.createWorker ?? defaultCreateWorker;
    this.spawn();
  }

  /** Begin a job on the current worker. */
  start(payload: StartJobPayload): void {
    this.worker?.postMessage({ type: "START_JOB", payload });
  }

  /** Cancel the active job: terminate and replace the worker. */
  cancel(): void {
    this.recreate();
  }

  /** Tear down for good with no replacement — call on unmount. */
  dispose(): void {
    this.kill();
  }

  private spawn(): void {
    const worker = this.makeWorker();
    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) =>
      this.handleMessage(e.data);
    worker.onerror = (e: ErrorEvent) => {
      console.error("Worker error:", e);
      this.opts.onError({
        message: e.message || "Worker crashed unexpectedly",
        phase: "loading",
        recoverable: false,
      });
      this.recreate();
    };
    this.worker = worker;
  }

  private kill(): void {
    const old = this.worker;
    this.worker = null;
    try {
      old?.terminate();
    } catch {
      // terminate can throw if the worker already crashed; ignore
    }
    // Drop queued synthesis targeting the dead worker so the queue can't grow
    // unbounded across repeated cancels.
    if (old) this.queue = this.queue.filter((q) => q.target !== old);
  }

  private recreate(): void {
    this.kill();
    this.spawn();
  }

  private handleMessage(msg: WorkerOutMessage): void {
    switch (msg.type) {
      case "PROGRESS":
        this.opts.onProgress(msg.payload);
        break;
      case "COMPLETE":
        this.opts.onComplete(msg.payload.zipBlob);
        break;
      case "ERROR":
        this.opts.onError(msg.payload);
        this.recreate();
        break;
      case "CAPABILITIES":
        this.opts.onCapabilities(msg.payload);
        break;
      case "REQUEST_TTS":
        this.enqueueTTS(msg.payload.id, msg.payload.text);
        break;
    }
  }

  private enqueueTTS(id: number, text: string): void {
    const target = this.worker;
    if (!target) return;
    this.queue.push({ id, text, target });
    void this.drainTTS();
  }

  private async drainTTS(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    let currentTarget: Worker | null = null;
    try {
      while (this.queue.length > 0) {
        const { id, text, target } = this.queue.shift()!;
        currentTarget = target;
        const wavBlob = await this.opts.synthesize(text);
        // Drop the result if the targeted worker was replaced meanwhile.
        if (this.worker === target) {
          target.postMessage({ type: "TTS_RESULT", payload: { id, wavBlob } });
        }
      }
    } catch (err) {
      // Drop a stale rejection if the targeted worker was replaced meanwhile
      // (mirrors the success-path guard above).
      if (this.worker === currentTarget) {
        this.opts.onError({
          message: errorMessage(err),
          phase: "tts",
          recoverable: false,
        });
        this.recreate();
      }
    } finally {
      this.draining = false;
    }
  }
}
