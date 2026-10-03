import { Module } from '@nestjs/common';
import { IntakeAgent } from './intake.agent';
import { languageModelProvider } from './language-model.provider';

@Module({
    providers: [languageModelProvider, IntakeAgent],
    exports: [IntakeAgent],
})
export class AgentsModule {}
