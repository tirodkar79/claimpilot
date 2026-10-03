import { RequestRateLimiter } from './request-rate-limiter';

/** Fake clock whose sleep advances time instantly and records each wait. */
function fakeClock() {
    let time = 0;
    const waits: number[] = [];
    return {
        now: () => time,
        sleep: async (ms: number) => {
            waits.push(ms);
            time += ms;
        },
        advance: (ms: number) => (time += ms),
        waits,
    };
}

describe('RequestRateLimiter', () => {
    it('lets requests through while under the limit', async () => {
        const clock = fakeClock();
        const limiter = new RequestRateLimiter(3, clock.now, clock.sleep);
        await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
        expect(clock.waits).toEqual([]);
    });

    it('makes the next request wait until the oldest one leaves the 60s window', async () => {
        const clock = fakeClock();
        const limiter = new RequestRateLimiter(2, clock.now, clock.sleep);
        await limiter.acquire(); // t=0
        clock.advance(10_000);
        await limiter.acquire(); // t=10s
        await limiter.acquire(); // must wait until t=60s
        expect(clock.waits).toEqual([50_000]);
        expect(clock.now()).toBe(60_000);
    });

    it('queues concurrent callers in order', async () => {
        const clock = fakeClock();
        const limiter = new RequestRateLimiter(1, clock.now, clock.sleep);
        const order: number[] = [];
        await Promise.all([1, 2, 3].map((n) => limiter.acquire().then(() => order.push(n))));
        expect(order).toEqual([1, 2, 3]);
        expect(clock.waits).toEqual([60_000, 60_000]);
    });
});
