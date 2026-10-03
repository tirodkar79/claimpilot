import { Body, Controller, Get, HttpCode, HttpStatus, MessageEvent, Param, Post, Sse } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBody, type ApiBodyOptions, ApiOperation, ApiTags } from '@nestjs/swagger';
import { map, Observable } from 'rxjs';
import { z } from 'zod';
import { Role } from '../auth/auth.constants';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { TraceService } from '../trace/trace.service';
import { ClaimsService, ClaimView } from './claims.service';
import { createClaimSchema, type CreateClaimDto } from './create-claim.dto';

type OpenApiSchema = Extract<ApiBodyOptions, { schema: unknown }>['schema'];

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
    constructor(
        private readonly claims: ClaimsService,
        private readonly trace: TraceService,
    ) {}

    /**
     * Submits a claim. Triage runs in the background; follow it via `GET /claims/:id/events`.
     * @param body Claim details and the claimant's message.
     */
    @Post()
    @Roles(Role.Claimant)
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({ summary: 'Submit a claim and start triage' })
    @ApiBody({ schema: z.toJSONSchema(createClaimSchema) as OpenApiSchema })
    @ApiAcceptedResponse({ description: 'Claim stored; triage started' })
    create(@Body(new ZodValidationPipe(createClaimSchema)) body: CreateClaimDto): Promise<ClaimView> {
        return this.claims.create(body);
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
