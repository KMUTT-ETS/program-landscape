import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ApiError } from '@kku/shared';
import { ZodSchema, ZodError } from 'zod';

// Wrap any Zod schema as a NestJS pipe.
//
//   @Get()
//   list(@Query(new ZodValidationPipe(ProgramListQuerySchema)) q: ProgramListQuery) { ... }
//
// Zod errors bubble up as ApiError('VALIDATION_FAILED', ...) and the
// global filter turns them into a standard error envelope.
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ApiError('VALIDATION_FAILED', 'Request validation failed', {
      issues: (result.error as ZodError).issues,
    });
  }
}
