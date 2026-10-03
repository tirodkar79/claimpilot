import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestContextMiddleware } from './request-context.middleware';

/** Opens a request context for every route. */
@Module({})
export class RequestContextModule implements NestModule {
    /**
     * Applies the request context middleware to all routes.
     * @param consumer Middleware consumer.
     */
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(RequestContextMiddleware).forRoutes('*path');
    }
}
