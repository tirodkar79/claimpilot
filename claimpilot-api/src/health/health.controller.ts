import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Connection, ConnectionStates } from 'mongoose';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
    constructor(@InjectConnection() private readonly connection: Connection) {}

    /**
     * Public liveness check that also confirms MongoDB is connected.
     * @throws ServiceUnavailableException (503) when MongoDB is not connected.
     */
    @Public()
    @Get()
    @ApiOperation({ summary: 'Liveness and MongoDB connectivity' })
    check() {
        if (this.connection.readyState !== ConnectionStates.connected) {
            throw new ServiceUnavailableException('MongoDB not connected');
        }
        return { status: 'ok', mongo: 'up', uptimeSeconds: Math.round(process.uptime()) };
    }
}
