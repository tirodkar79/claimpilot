import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { LANGUAGE_MODEL } from '../agents/language-model.provider';
import { mockLanguageModel, type MockCall, type MockStep } from '../agents/testing/mock-language-model';

const CLAIMANT = { 'x-api-key': 'claimant-key' };
const REVIEWER = { 'x-api-key': 'reviewer-key' };

let mongo: MongoMemoryServer;
let app: INestApplication;
let intakeReply: Record<string, unknown> = {};

/** A flight date inside P-77's cover and claim deadline, whenever the test runs. */
const recentFlightDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const policyReading = {
    delayMeasure: 'departure',
    relevantExclusions: [{ type: 'severe_weather', clauseId: '7.3', summary: 'Fog delays are excluded.' }],
    summary: 'Delay is measured from departure. Fog could trigger the weather exclusion.',
    citedClauseIds: ['4.1', '7.3'],
};

/**
 * Plays every agent with one shared mock model, told apart by their instructions: tool-using agents
 * call one tool, then answer.
 * @param call What the model was asked.
 */
function respond(call: MockCall): MockStep {
    if (call.system.includes('You extract facts')) return { text: JSON.stringify(intakeReply) };
    if (call.system.includes('You coordinate')) {
        return call.hasToolResult
            ? { text: 'Policy P-77 covers the flight; fog may be excluded under 7.3.' }
            : { toolCall: { name: 'consultPolicyAgent', input: { focus: 'cover and exclusions' } } };
    }
    return call.hasToolResult
        ? { text: JSON.stringify(policyReading) }
        : { toolCall: { name: 'searchPolicyClauses', input: { query: 'weather exclusion' } } };
}

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
        .useValue(mockLanguageModel(respond))
        .compile();
    app = moduleRef.createNestApplication();
    await app.init();
}, 120_000);

afterAll(async () => {
    await app?.close();
    await mongo?.stop();
});

/**
 * Reads a claim's SSE stream to completion and returns `actor:type` per event.
 * @param id Claim id.
 */
async function streamedEvents(id: string): Promise<string[]> {
    const res = await request(app.getHttpServer()).get(`/claims/${id}/events`).set(CLAIMANT).buffer(true);
    return res.text
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)))
        .map((event: { actor: string; type: string }) => `${event.actor}:${event.type}`);
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

    it('delegates to the Policy agent and streams every step', async () => {
        intakeReply = {
            flightNumber: '6E-2134',
            flightDate: recentFlightDate,
            origin: 'BOM',
            destination: 'DEL',
            claimedDelayMinutes: 240,
            claimedCause: 'fog',
        };

        const created = await request(app.getHttpServer()).post('/claims').set(CLAIMANT).send(body).expect(202);
        expect(created.body).toMatchObject({ status: 'triaging', customerId: 'C-1042' });

        expect(await streamedEvents(created.body.id)).toEqual([
            'orchestrator:triage.started',
            'intake:agent.started',
            'intake:agent.completed',
            'orchestrator:agent.started',
            'orchestrator:agent.delegated',
            'policy:agent.started',
            'policy:tool.called',
            'policy:agent.completed',
            'orchestrator:agent.completed',
            'orchestrator:decision',
            'orchestrator:triage.completed',
        ]);

        const claim = await request(app.getHttpServer()).get(`/claims/${created.body.id}`).set(REVIEWER).expect(200);
        expect(claim.body).toMatchObject({
            status: 'completed',
            facts: { flightNumber: '6E2134', claimedDelayMinutes: 240 },
            outcome: { decision: 'PENDING', citations: [{ clauseId: '2.1' }, { clauseId: '9.2' }] },
            evidence: {
                policy: {
                    policyId: 'P-77',
                    relevantExclusions: [{ clauseId: '7.3' }],
                    citedClauses: [{ id: '4.1' }, { id: '7.3' }],
                    droppedCitations: [],
                },
            },
            summary: 'Policy P-77 covers the flight; fog may be excluded under 7.3.',
        });
    });

    it('rejects a flight outside the cover period, citing the clause', async () => {
        intakeReply = { ...intakeReply, flightDate: recentFlightDate };
        const expired = { ...body, policyId: 'P-12' };

        const created = await request(app.getHttpServer()).post('/claims').set(CLAIMANT).send(expired).expect(202);
        await streamedEvents(created.body.id);

        const claim = await request(app.getHttpServer()).get(`/claims/${created.body.id}`).set(CLAIMANT);
        expect(claim.body.outcome).toMatchObject({
            decision: 'REJECT',
            citations: [{ clauseId: '2.1', title: 'Period of cover' }],
        });
    });

    it('asks for missing facts without consulting any other agent', async () => {
        intakeReply = {
            flightNumber: null,
            flightDate: null,
            origin: null,
            destination: null,
            claimedDelayMinutes: 240,
            claimedCause: null,
        };

        const created = await request(app.getHttpServer()).post('/claims').set(CLAIMANT).send(body).expect(202);
        const events = await streamedEvents(created.body.id);
        expect(events.filter((event) => event.startsWith('policy:'))).toEqual([]);

        const claim = await request(app.getHttpServer()).get(`/claims/${created.body.id}`).set(CLAIMANT);
        expect(claim.body.outcome).toEqual({
            decision: 'NEED_INFO',
            reasons: ['What is your flight number (for example 6E-2134)?', 'On what date was your flight?'],
            citations: [],
        });
    });

    it('returns 404 for unknown or malformed claim ids', async () => {
        await request(app.getHttpServer()).get('/claims/000000000000000000000000').set(CLAIMANT).expect(404);
        await request(app.getHttpServer()).get('/claims/not-an-id/events').set(CLAIMANT).expect(404);
    });
});
