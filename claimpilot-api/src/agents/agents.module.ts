import { Module } from '@nestjs/common';
import { IntakeAgent } from './intake.agent';
import { languageModelProvider } from './language-model.provider';
import { OrchestratorAgent } from './orchestrator.agent';
import { PolicyAgent } from './policy.agent';

@Module({
    providers: [languageModelProvider, IntakeAgent, OrchestratorAgent, PolicyAgent],
    exports: [IntakeAgent, OrchestratorAgent, PolicyAgent],
})
export class AgentsModule {}
