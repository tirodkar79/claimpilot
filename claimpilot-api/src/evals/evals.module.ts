import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EnvConfig } from '../config/env.validation';
import { EVAL_CONNECTION, EVAL_DATABASE } from './evals.constants';
import { EvalRun, EvalRunSchema } from './eval-run.schema';
import { EvalRunsRepository } from './eval-runs.repository';
import { EvalsController } from './evals.controller';
import { EvalsService } from './evals.service';

/** Eval runs live in their own database, next to the eval claims, apart from real claims. */
@Module({
    imports: [
        MongooseModule.forRootAsync({
            connectionName: EVAL_CONNECTION,
            inject: [ConfigService],
            useFactory: (config: ConfigService<EnvConfig, true>) => ({
                uri: config.get('MONGO_URI', { infer: true }),
                dbName: EVAL_DATABASE,
                serverSelectionTimeoutMS: 5000,
            }),
        }),
        MongooseModule.forFeature([{ name: EvalRun.name, schema: EvalRunSchema }], EVAL_CONNECTION),
    ],
    controllers: [EvalsController],
    providers: [EvalRunsRepository, EvalsService],
    exports: [EvalRunsRepository],
})
export class EvalsModule {}
