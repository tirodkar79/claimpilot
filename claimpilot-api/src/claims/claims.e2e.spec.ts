import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { LANGUAGE_MODEL } from '../agents/language-model.provider';
import { mockLanguageModel } from '../agents/testing/mock-language-model';

const CLAIMANT = { 'x-api-key': 'claimant-key' };
const REVIEWER = { 'x-api-key': 'reviewer-key' };

let mongo: MongoMemoryServer;
let app: INestApplication;
let modelReply = '';

// Boots the real app (guards, filter, Mongo, SSE) with only the language model mocked.
beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
        MONGO_URI: `${mongo.getUri()}claimpilot`,
        API_KEYS: 'claimant:claimant-key,reviewer:reviewer-key',
        GOOGLE_GENERATIVE_AI_API_KEY: 'unused-in-tests',
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    // Imported after the env is set: ConfigModule validates it when AppModule is first loaded.
    const { AppModule } = require('../app.module') as typeof import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(LANGUAGE_MODEL)
        .useValue(mockLanguageModel(() => modelReply))
        .compile();
    app = moduleRef.createNestApplication();
    await app.init();
}, 120_000);

afterAll(async () => {
    await app?.close();
    await mongo?.stop();
});

/**
 * Reads a claim's SSE stream to completion and returns the event types.
 * @param id Claim id.
 */
async function streamedEventTypes(id: string): Promise<string[]> {
    const res = await request(app.getHttpServer()).get(`/claims/${id}/events`).set(CLAIMANT).buffer(true);
    return res.text
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)).type);
}

describe('Claims API', () => {
    const body = { customerId: 'C-1042', policyId: 'P-77', message: 'My flight 6E-2134 was delayed four hours' };

    it('requires an API key, and only claimants may submit', async () => {
        await request(app.getHttpServer()).post('/claims').send(body).expect(401);
        await request(app.getHttpServer()).post('/claims').set(REVIEWER).send(body).expect(403);
    });

    it('validates the body', async () => {
        const res = await request(app.getHttpServer()).post('/claims').set(CLAIMANT).send({ message: 'x' }).expect(400);
        expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
            expect.arrayContaining(['customerId', 'policyId', 'message']),
        );
    });

    it('triages a complete claim to PENDING and streams the full trace', async () => {
        modelReply = JSON.stringify({
            flightNumber: '6E-2134',
            flightDate: '2026-09-12',
            origin: 'BOM',
            destination: 'DEL',
            claimedDelayMinutes: 240,
            claimedCause: null,
        });

        const created = await request(app.getHttpServer()).post('/claims').set(CLAIMANT).send(body).expect(202);
        expect(created.body).toMatchObject({ status: 'triaging', customerId: 'C-1042' });

        expect(await streamedEventTypes(created.body.id)).toEqual([
            'triage.started',
            'agent.started',
            'agent.completed',
            'decision',
            'triage.completed',
        ]);

        const claim = await request(app.getHttpServer()).get(`/claims/${created.body.id}`).set(REVIEWER).expect(200);
        expect(claim.body).toMatchObject({
            status: 'completed',
            facts: { flightNumber: '6E2134', claimedDelayMinutes: 240 },
            outcome: { decision: 'PENDING' },
        });
    });

    it('asks for missing facts', async () => {
        modelReply = JSON.stringify({
            flightNumber: null,
            flightDate: null,
            origin: null,
            destination: null,
            claimedDelayMinutes: 240,
            claimedCause: null,
        });

        const created = await request(app.getHttpServer()).post('/claims').set(CLAIMANT).send(body).expect(202);
        await streamedEventTypes(created.body.id);

        const claim = await request(app.getHttpServer()).get(`/claims/${created.body.id}`).set(CLAIMANT);
        expect(claim.body.outcome).toEqual({
            decision: 'NEED_INFO',
            reasons: ['What is your flight number (for example 6E-2134)?', 'On what date was your flight?'],
        });
    });

    it('returns 404 for unknown or malformed claim ids', async () => {
        await request(app.getHttpServer()).get('/claims/000000000000000000000000').set(CLAIMANT).expect(404);
        await request(app.getHttpServer()).get('/claims/not-an-id/events').set(CLAIMANT).expect(404);
    });
});
