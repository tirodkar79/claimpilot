import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EnvConfig } from '../config/env.validation';

@Module({
    imports: [
        MongooseModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService<EnvConfig, true>) => ({
                uri: config.get('MONGO_URI', { infer: true }),
                serverSelectionTimeoutMS: 5000,
            }),
        }),
    ],
})
export class MongoModule {}
