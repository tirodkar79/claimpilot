const WINDOW_MS = 60_000;

/**
 * Sliding-window limiter: at most `perMinute` acquisitions in any 60 seconds. Callers queue in order, so
 * parallel agents share the budget fairly. Used to stay under free-tier model quotas instead of failing
 * with 429 and referring claims to a human.
 */
export class RequestRateLimiter {
    private readonly started: number[] = [];
    private queue: Promise<void> = Promise.resolve();

    /**
     * @param perMinute Maximum requests per rolling minute.
     * @param now Clock; injectable for tests.
     * @param sleep Delay function; injectable for tests.
     */
    constructor(
        private readonly perMinute: number,
        private readonly now: () => number = Date.now,
        private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    ) {}

    /** Resolves when a request may start, waiting if the last minute is already full. */
    acquire(): Promise<void> {
        const turn = this.queue.then(() => this.waitForSlot());
        this.queue = turn.catch(() => undefined);
        return turn;
    }

    /** Waits until fewer than `perMinute` requests started in the last minute, then records this one. */
    private async waitForSlot(): Promise<void> {
        for (;;) {
            const cutoff = this.now() - WINDOW_MS;
            while (this.started.length && this.started[0] <= cutoff) this.started.shift();
            if (this.started.length < this.perMinute) break;
            await this.sleep(this.started[0] - cutoff);
        }
        this.started.push(this.now());
    }
}
