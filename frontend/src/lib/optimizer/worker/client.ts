/**
 * Main-thread side of the optimizer worker: numbers each job, drops replies
 * to anything but the newest job, and replaces the worker when a new job
 * arrives while one is still searching (a running search cannot be
 * interrupted, so the newest job would otherwise wait up to
 * FINAL_BUDGET_MS behind a result nobody wants).
 *
 * Auto and Browse all each own a client, so each has its own worker and
 * neither replaces the other's search. `kind` says which job the client
 * posts; its replies are typed to match.
 */
import type { BrowseJob, OptimizeJob, OptimizeReply, PlainRequest } from "./protocol";

type ErrorReply = { id: number; phase: "error"; message: string };
/** A reply ends its job when it is an error or says it is settled. */
type AnyReply = ErrorReply | { id: number; phase: string; settled: boolean };

/** The parts of a Worker the client uses, so tests can pass a fake. */
export type WorkerPort<Reply = OptimizeReply> = {
  post: (job: OptimizeJob | BrowseJob) => void;
  terminate: () => void;
  listen: (onReply: (reply: Reply) => void, onFailure: (message: string) => void) => void;
};

export function createOptimizerWorker<Reply = OptimizeReply>(): WorkerPort<Reply> {
  // A prebuilt, self-contained module (see optimize.worker.ts for why); the bundler serves it as a static file.
  const worker = new Worker(new URL("./optimize.worker.bundle.js", import.meta.url), { type: "module" });
  return {
    post: (job) => worker.postMessage(job),
    terminate: () => worker.terminate(),
    listen: (onReply, onFailure) => {
      worker.onmessage = (event: MessageEvent<Reply>) => onReply(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        onFailure(event.message || "The optimizer stopped unexpectedly.");
      };
      worker.onmessageerror = () => onFailure("The optimizer's answer could not be read.");
    },
  };
}

export class OptimizerClient<Reply extends AnyReply = OptimizeReply> {
  private port: WorkerPort<Reply> | null = null;
  private latest = 0;
  /** True while the newest job may still send a reply. */
  private pending = false;

  constructor(
    private readonly create: () => WorkerPort<Reply>,
    private readonly onReply: (reply: Reply | ErrorReply) => void,
    private readonly kind: "auto" | "browse" = "auto",
  ) {}

  /**
   * Starts a job and returns its id. Replies, failures included, always
   * arrive after this returns, so the caller can record the id first.
   */
  run(request: PlainRequest): number {
    const id = ++this.latest;
    if (this.pending) this.dropWorker();
    this.pending = true;
    try {
      this.ensurePort().post(this.kind === "browse" ? { id, kind: "browse", request } : { id, request });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      queueMicrotask(() => this.fail(id, `The optimizer could not start: ${message}`));
    }
    return id;
  }

  /**
   * Stops the newest job if it may still reply (the follow-up search after
   * an unproven first answer runs for up to FINAL_BUDGET_MS). A worker with
   * nothing pending is kept, so the next run skips loading it again.
   */
  cancel() {
    if (!this.pending) return;
    this.pending = false;
    this.dropWorker();
  }

  dispose() {
    this.pending = false;
    this.dropWorker();
  }

  private ensurePort(): WorkerPort<Reply> {
    if (this.port) return this.port;
    const port = this.create();
    port.listen(
      (reply) => {
        if (this.port !== port) return;
        this.receive(reply);
      },
      (message) => {
        if (this.port !== port) return;
        this.dropWorker();
        this.fail(this.latest, message);
      },
    );
    this.port = port;
    return port;
  }

  private receive(reply: Reply) {
    // A reply to an older job is stale: its inputs are no longer on screen.
    if (reply.id !== this.latest) return;
    if (reply.phase === "error" || ("settled" in reply && reply.settled)) this.pending = false;
    this.onReply(reply);
  }

  private fail(id: number, message: string) {
    if (id !== this.latest || !this.pending) return;
    this.pending = false;
    this.onReply({ id, phase: "error", message });
  }

  private dropWorker() {
    this.port?.terminate();
    this.port = null;
  }
}
