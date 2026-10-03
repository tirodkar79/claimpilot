import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../app.module';
import { ClaimsRepository } from '../claims/claims.repository';
import { reviewedCase } from './eval-cases';
import { REVIEWED_CASES_DIR } from './evals.constants';

/**
 * `npm run eval:export-reviews`: writes every resolved review as a case in `evals/cases/reviewed/`, so the
 * next eval run reports how often triage agrees with people.
 */
async function main(): Promise<void> {
    const logger = new Logger('Evals');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
    try {
        const reviewed = await app
            .get(ClaimsRepository, { strict: false })
            .find({ 'review.status': 'resolved', injectFailures: { $size: 0 } });
        mkdirSync(REVIEWED_CASES_DIR, { recursive: true });
        for (const claim of reviewed) {
            const evalCase = reviewedCase(claim);
            writeFileSync(join(REVIEWED_CASES_DIR, `${evalCase.id}.json`), `${JSON.stringify(evalCase, null, 4)}\n`);
        }
        logger.log(`Exported ${reviewed.length} reviewed claim(s) to ${REVIEWED_CASES_DIR}`);
    } finally {
        await app.close();
    }
}

void main();
