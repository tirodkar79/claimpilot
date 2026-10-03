import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { API_KEY_HEADER, REQUEST_ID_HEADER } from './common/constants/headers.constants';
import { EnvConfig } from './config/env.validation';

/**
 * Serves Swagger UI at `/docs` and the OpenAPI spec at `/docs-json` (the web app generates types from it).
 * @param app Nest application.
 */
function setupSwagger(app: INestApplication): void {
    const document = new DocumentBuilder()
        .setTitle('ClaimPilot API')
        .setDescription('Multi-agent flight-delay claim triage')
        .setVersion('0.1.0')
        .addApiKey({ type: 'apiKey', name: API_KEY_HEADER, in: 'header' }, 'api-key')
        .addSecurityRequirements('api-key')
        .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, document), {
        jsonDocumentUrl: 'docs-json',
    });
}

/** Creates the app, configures CORS, shutdown hooks and Swagger, then starts listening on PORT. */
async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);
    const config = app.get(ConfigService<EnvConfig, true>);

    app.enableCors({
        origin: config.get('CORS_ORIGINS', { infer: true }),
        exposedHeaders: [REQUEST_ID_HEADER],
    });
    app.enableShutdownHooks();
    setupSwagger(app);

    await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
