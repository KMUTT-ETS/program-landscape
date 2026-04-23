import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ApiError } from '@kku/shared';
import { ZodError, ZodType, ZodTypeDef } from 'zod';

// Wrap any Zod schema as a NestJS pipe.
//
//   @Get()
//   list(@Query(new ZodValidationPipe(ProgramListQuerySchema)) q: ProgramListQuery) { ... }
//
// Zod errors bubble up as ApiError('VALIDATION_FAILED', ...) and the
// global filter turns them into a standard error envelope.
//
// NOTE: constructor accepts `ZodType<T, ZodTypeDef, unknown>` (not the
// narrower `ZodSchema<T>`) so schemas with `.default(...)` or `.transform(...)`
// — which produce asymmetric input/output types — compose cleanly. The
// runtime validates + narrows the input; TS just needs the signature to
// admit the asymmetry.
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ApiError('VALIDATION_FAILED', 'Request validation failed', {
      issues: (result.error as ZodError).issues,
    });
  }
}
