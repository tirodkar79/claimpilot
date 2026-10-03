import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBody, type ApiBodyOptions, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Role } from '../auth/auth.constants';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { Page } from '../mongo/mongo.repository';
import { reviewDecisionSchema, type ReviewDecisionDto } from './review-decision.dto';
import { ReviewItem, ReviewsService } from './reviews.service';

type OpenApiSchema = Extract<ApiBodyOptions, { schema: unknown }>['schema'];
const statusSchema = z.enum(['pending', 'resolved']);

/** Review queue for referred claims. Reviewers only. */
@ApiTags('reviews')
@Roles(Role.Reviewer)
@Controller('reviews')
export class ReviewsController {
    constructor(private readonly reviews: ReviewsService) {}

    /**
     * The review queue (pending, oldest first) or review history (resolved, newest first).
     * @param status Pending or resolved.
     * @param page 1-based page.
     * @param limit Page size (max 100).
     */
    @Get()
    @ApiOperation({ summary: 'List referred claims' })
    @ApiQuery({ name: 'status', enum: statusSchema.options, required: false })
    list(
        @Query('status', new DefaultValuePipe('pending'), new ZodValidationPipe(statusSchema))
        status: 'pending' | 'resolved',
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    ): Promise<Page<ReviewItem>> {
        return this.reviews.list(status, page, limit);
    }

    /**
     * Records a reviewer's decision on a referred claim.
     * @param claimId Claim id.
     * @param body Decision, note and optional payout amount.
     */
    @Post(':claimId/decision')
    @ApiOperation({ summary: 'Decide a referred claim' })
    @ApiBody({ schema: z.toJSONSchema(reviewDecisionSchema) as OpenApiSchema })
    decide(
        @Param('claimId') claimId: string,
        @Body(new ZodValidationPipe(reviewDecisionSchema)) body: ReviewDecisionDto,
    ): Promise<ReviewItem> {
        return this.reviews.decide(claimId, body);
    }
}
