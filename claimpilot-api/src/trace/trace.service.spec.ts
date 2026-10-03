import { Types } from 'mongoose';
import { firstValueFrom, toArray } from 'rxjs';
import type { TraceEvent } from './trace-event.schema';
import type { TraceRepository } from './trace.repository';
import { TraceService } from './trace.service';

const claimId = new Types.ObjectId().toHexString();

/** In-memory stand-in for the repository; `release` controls when history reads resolve. */
function fakeRepository() {
    const stored: TraceEvent[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const repository = {
        create: async (doc: Partial<TraceEvent>) => {
            const event = { ...doc, _id: new Types.ObjectId() } as TraceEvent;
            stored.push(event);
            return event;
        },
        findByClaim: async (id: string) => {
            await gate;
            return stored.filter((event) => String(event.claimId) === id);
        },
    };
    return { repository: repository as unknown as TraceRepository, release };
}

describe('TraceService', () => {
    it('numbers events per claim', async () => {
        const { repository } = fakeRepository();
        const recorder = new TraceService(repository).forClaim(claimId);

        const first = await recorder.record('orchestrator', 'triage.started', 'Triage started');
        const second = await recorder.record('intake', 'agent.started', 'Extracting');

        expect([first.seq, second.seq]).toEqual([1, 2]);
        expect(first).toMatchObject({ claimId, actor: 'orchestrator', type: 'triage.started' });
    });

    it('streams history then live events without duplicates, and completes on triage.completed', async () => {
        const { repository, release } = fakeRepository();
        const service = new TraceService(repository);
        const recorder = service.forClaim(claimId);
        await recorder.record('orchestrator', 'triage.started', 'Triage started');

        const received = firstValueFrom(service.stream(claimId).pipe(toArray()));

        // Recorded while history is still loading: must arrive once, in order.
        await recorder.record('intake', 'agent.started', 'Extracting');
        release();
        await new Promise((resolve) => setImmediate(resolve));
        await recorder.record('orchestrator', 'triage.completed', 'Triage completed');

        expect((await received).map((event) => event.seq)).toEqual([1, 2, 3]);
    });

    it('ignores events of other claims', async () => {
        const { repository, release } = fakeRepository();
        const service = new TraceService(repository);
        release();

        const received = firstValueFrom(service.stream(claimId).pipe(toArray()));
        await service.forClaim(new Types.ObjectId().toHexString()).record('orchestrator', 'triage.completed', 'Other');
        await new Promise((resolve) => setImmediate(resolve));
        await service.forClaim(claimId).record('orchestrator', 'triage.completed', 'Mine');

        expect((await received).map((event) => event.message)).toEqual(['Mine']);
    });
});
