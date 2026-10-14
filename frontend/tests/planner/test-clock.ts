type Timer = { at: number; callback: () => void };

/** Controls timeout ordering without changing Date or the provider's debounce. */
export class TestClock {
  private now = 0;
  private nextId = 1;
  private timers = new Map<number, Timer>();
  private original: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } | null = null;

  install() {
    if (this.original) throw new Error("test clock is already installed");
    this.original = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
    // SAFETY: the provider uses timeout handles only with clearTimeout, never
    // Node's ref/unref methods. Both replacements share the same numeric IDs.
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => {
      const id = this.nextId++;
      this.timers.set(id, { at: this.now + Math.max(0, ms), callback: () => callback(...args) });
      return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: number) => {
      this.timers.delete(id);
    }) as unknown as typeof clearTimeout;
  }

  restore() {
    if (!this.original) throw new Error("test clock is not installed");
    globalThis.setTimeout = this.original.setTimeout;
    globalThis.clearTimeout = this.original.clearTimeout;
    this.original = null;
    this.timers.clear();
    this.now = 0;
  }

  async advance(ms: number, settle: () => Promise<void>) {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("clock advance must be a finite non-negative duration");
    const target = this.now + ms;
    await settle();
    // Settle React between callbacks so effects can cancel or schedule timers
    // before the next deadline, just as they do between browser timer tasks.
    for (let fired = 0; ; fired += 1) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      if (fired === 1000) throw new Error("test clock exceeded 1000 callbacks in one advance");
      const [id, timer] = next;
      this.now = timer.at;
      this.timers.delete(id);
      timer.callback();
      await settle();
    }
    this.now = target;
  }
}
