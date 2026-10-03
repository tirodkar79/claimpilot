import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** `@Body(new ZodValidationPipe(schema))`: validates the input and returns the parsed, typed value. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
    constructor(private readonly schema: ZodType<T>) {}

    /**
     * Parses the value against the schema.
     * @param value Raw input.
     * @throws BadRequestException listing each invalid field.
     */
    transform(value: unknown): T {
        const result = this.schema.safeParse(value);
        if (!result.success) {
            throw new BadRequestException({
                message: 'Validation failed',
                details: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
            });
        }
        return result.data;
    }
}
