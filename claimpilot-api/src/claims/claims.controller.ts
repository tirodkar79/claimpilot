import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    MessageEvent,
    Param,
    Post,
    Sse,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiAcceptedResponse, ApiBody, type ApiBodyOptions, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { map, Observable } from 'rxjs';
import { z } from 'zod';
import { Role } from '../auth/auth.constants';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { EnvConfig } from '../config/env.validation';
import { TraceService } from '../trace/trace.service';
import { FAILURE_TARGETS, type FailureTarget } from './claims.constants';
import { ClaimsService, ClaimView } from './claims.service';
import { createClaimSchema, type CreateClaimDto } from './create-claim.dto';

type OpenApiSchema = Extract<ApiBodyOptions, { schema: unknown }>['schema'];

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
    constructor(
        private readonly claims: ClaimsService,
        private readonly trace: TraceService,
        private readonly config: ConfigService<EnvConfig, true>,
    ) {}

    /**
     * Submits a claim. Triage runs in the background; follow it via `GET /claims/:id/events`.
     * @param body Claim details and the claimant's message.
     * @param injectHeader Optional comma-separated steps to force to fail (only with ALLOW_FAILURE_INJECTION).
     */
    @Post()
    @Roles(Role.Claimant)
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Submit a claim and start triage' })
    @ApiBody({ schema: z.toJSONSchema(createClaimSchema) as OpenApiSchema })
    @ApiHeader({
        name: 'x-inject-failure',
        required: false,
        description: `Demo/eval only: steps to fail (${FAILURE_TARGETS.join(', ')}). Needs ALLOW_FAILURE_INJECTION=true.`,
    })
    @ApiAcceptedResponse({ description: 'Claim stored; triage started' })
    create(
        @Body(new ZodValidationPipe(createClaimSchema)) body: CreateClaimDto,
        @Headers('x-inject-failure') injectHeader?: string,
    ): Promise<ClaimView> {
        return this.claims.create(body, this.parseInjection(injectHeader));
    }

    /**
     * Validates the failure-injection header.
     * @param header Raw header value.
     * @throws BadRequestException when injection is disabled or a step name is unknown.
     */
    private parseInjection(header: string | undefined): FailureTarget[] {
        if (!header) return [];
        if (!this.config.get('ALLOW_FAILURE_INJECTION', { infer: true })) {
            throw new BadRequestException('Failure injection is disabled (ALLOW_FAILURE_INJECTION=false)');
        }
        const targets = header
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
        const unknown = targets.filter((target) => !(FAILURE_TARGETS as readonly string[]).includes(target));
        if (unknown.length) throw new BadRequestException(`Unknown failure target(s): ${unknown.join(', ')}`);
        return targets as FailureTarget[];
    }

    /**
     * Returns a claim with its extracted facts and outcome once triage finishes.
     * @param id Claim id.
     */
    @Get(':id')
    @ApiOperation({ summary: 'Get a claim' })
    get(@Param('id') id: string): Promise<ClaimView> {
        return this.claims.get(id);
    }

    /**
     * Server-sent events for a claim's triage: full history, then live events until it completes.
     * Returns 404 before the stream opens if the claim doesn't exist.
     * @param id Claim id.
     */
    @Sse(':id/events')
    @ApiOperation({ summary: 'Stream triage events (SSE)' })
    async events(@Param('id') id: string): Promise<Observable<MessageEvent>> {
        await this.claims.get(id);
        return this.trace.stream(id).pipe(map((event) => ({ data: event })));
    }
}
