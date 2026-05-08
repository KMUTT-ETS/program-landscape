// Web-side re-export of the impersonation helpers. The actual schema +
// decoder live in @kku/shared so the NestJS JWT guard can apply the
// SAME override on every request — see apps/api/src/common/jwt-auth.guard.ts.
//
// Without that shared module, the web's session callback would override
// the user's role for SSR but the API would still see the original
// JWT-derived role and silently grant full access. (Found 2026-05-09.)

export {
  IMPERSONATION_COOKIE,
  ImpersonationPayloadSchema,
  canImpersonate,
  encodeImpersonation,
  roleNeedsFaculty,
  roleNeedsDepartment,
  tryDecodeImpersonation,
  type ImpersonationPayload,
} from '@kku/shared';
