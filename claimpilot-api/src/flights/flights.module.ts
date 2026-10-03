import { Module } from '@nestjs/common';
import { HttpClientModule } from '../http-client/http-client.module';
import { FlightDataService } from './flight-data.service';

@Module({
    imports: [HttpClientModule],
    providers: [FlightDataService],
    exports: [FlightDataService],
})
export class FlightsModule {}
