import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ApiMeta, ApiSuccess } from '@kku/shared';
import { PROVENANCE_META } from './decorators';

// Wraps every controller response in the ApiSuccess envelope.
//
// If the controller returns `{ data, meta }`, we keep that meta and add
// defaults; otherwise we treat the returned value as `data`. Controllers
// should return plain values from services and attach @Provenance() at the
// route for cross-cutting metadata.
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    ctx: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiSuccess<unknown>> {
    const provenance = this.reflector.getAllAndOverride<Partial<ApiMeta>>(
      PROVENANCE_META,
      [ctx.getHandler(), ctx.getClass()],
    );

    return next.handle().pipe(
      map((value) => {
        const hasEnvelope =
          value &&
          typeof value === 'object' &&
          'data' in (value as object) &&
          'meta' in (value as object);

        const data = hasEnvelope ? (value as { data: unknown }).data : value;
        const meta = hasEnvelope
          ? ((value as { meta: Partial<ApiMeta> }).meta ?? {})
          : {};

        const finalMeta: ApiMeta = {
          freshnessDate: null,
          sources: [],
          ...provenance,
          ...meta,
        };

        return { data, meta: finalMeta, error: null };
      }),
    );
  }
}
