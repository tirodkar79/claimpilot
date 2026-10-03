import { Module } from '@nestjs/common';
import { FlightsModule } from '../flights/flights.module';
import { WeatherModule } from '../weather/weather.module';
import { FlightAgent } from './flight.agent';
import { IntakeAgent } from './intake.agent';
import { languageModelProvider } from './language-model.provider';
import { OrchestratorAgent } from './orchestrator.agent';
import { PolicyAgent } from './policy.agent';
import { WeatherAgent } from './weather.agent';

@Module({
    imports: [FlightsModule, WeatherModule],
    providers: [languageModelProvider, IntakeAgent, OrchestratorAgent, PolicyAgent, FlightAgent, WeatherAgent],
    exports: [IntakeAgent, OrchestratorAgent, PolicyAgent, FlightAgent, WeatherAgent],
})
export class AgentsModule {}
