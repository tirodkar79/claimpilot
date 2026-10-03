import { Module } from '@nestjs/common';
import { FlightsModule } from '../flights/flights.module';
import { FlightAgent } from './flight.agent';
import { IntakeAgent } from './intake.agent';
import { languageModelProvider } from './language-model.provider';
import { OrchestratorAgent } from './orchestrator.agent';
import { PolicyAgent } from './policy.agent';

@Module({
    imports: [FlightsModule],
    providers: [languageModelProvider, IntakeAgent, OrchestratorAgent, PolicyAgent, FlightAgent],
    exports: [IntakeAgent, OrchestratorAgent, PolicyAgent, FlightAgent],
})
export class AgentsModule {}
