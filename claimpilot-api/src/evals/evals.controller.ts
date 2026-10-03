import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../auth/auth.constants';
import { Roles } from '../auth/decorators/roles.decorator';
import { EvalsService, type EvalRunSummaryView, type EvalRunView } from './evals.service';

/** Results of eval runs (`npm run eval` writes them). Reviewers only. */
@ApiTags('evals')
@Roles(Role.Reviewer)
@Controller('evals/runs')
export class EvalsController {
    constructor(private readonly evals: EvalsService) {}

    /** Recent runs with their headline metrics, newest first. */
    @Get()
    @ApiOperation({ summary: 'List recent eval runs' })
    list(): Promise<EvalRunSummaryView[]> {
        return this.evals.listRecent();
    }

    /**
     * One run with every case, attempt and check.
     * @param id Run id.
     */
    @Get(':id')
    @ApiOperation({ summary: 'Get an eval run' })
    get(@Param('id') id: string): Promise<EvalRunView> {
        return this.evals.get(id);
    }
}
