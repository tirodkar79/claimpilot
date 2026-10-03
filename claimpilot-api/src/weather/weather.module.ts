import { Module } from '@nestjs/common';
import { OpenMeteoMcpService } from './open-meteo-mcp.service';

@Module({
    providers: [OpenMeteoMcpService],
    exports: [OpenMeteoMcpService],
})
export class WeatherModule {}
