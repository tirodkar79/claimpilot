import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TraceEvent, TraceEventSchema } from './trace-event.schema';
import { TraceRepository } from './trace.repository';
import { TraceService } from './trace.service';

@Module({
    imports: [MongooseModule.forFeature([{ name: TraceEvent.name, schema: TraceEventSchema }])],
    providers: [TraceRepository, TraceService],
    exports: [TraceService],
})
export class TraceModule {}
