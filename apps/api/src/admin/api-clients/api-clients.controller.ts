// Admin API for external staff-profile API clients and their keys.
// Backs /admin/external/api-clients. Key plaintext appears in exactly two
// responses — create and issue — and never in a request body, so @AuditLog
// (which records the request body) never sees one.
import { Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import {
  ApiClientInputSchema,
  ApiClientPatchSchema,
  createApiClient,
  getApiClientDetail,
  issueApiClientKey,
  IssueKeySchema,
  listApiClients,
  revokeApiClientKey,
  RevokeKeySchema,
  updateApiClient,
  type ApiClientDetail,
  type ApiClientInput,
  type ApiClientKeyView,
  type ApiClientPatch,
  type ApiClientSummary,
  type ApiClientView,
  type IssuedApiKey,
} from '@kku/db';
import { ApiError, type SessionUser } from '@kku/shared';
import { z } from 'zod';
import { AuditLog, AuthSession, Authorized, ZodValidationPipe } from '../../common';

// Allowlists are off until nginx's set_real_ip_from is pinned to the KKU proxy;
// before that the client address cannot be trusted, so an allowlist would be
// security theatre.
function assertAllowlistPermitted(ipAllowlist: readonly string[] | undefined): void {
  if (ipAllowlist && ipAllowlist.length > 0 && process.env.API_CLIENT_IP_ALLOWLIST !== 'enabled') {
    throw new ApiError('VALIDATION_FAILED', 'Per-client IP allowlists are not enabled on this deployment', {
      reason: 'ip_allowlist_disabled',
    });
  }
}

@Controller('/admin/api-clients')
export class ApiClientsController {
  @Get()
  @Authorized('api_clients:admin')
  list(): Promise<ApiClientSummary[]> {
    return listApiClients();
  }

  @Get(':id')
  @Authorized('api_clients:admin')
  async detail(@Param('id') id: string): Promise<ApiClientDetail> {
    const d = await getApiClientDetail(id);
    if (!d) throw new NotFoundException('API client not found');
    return d;
  }

  @Post()
  @Authorized('api_clients:admin')
  @AuditLog({ action: 'api_client.create', entityType: 'ApiClient' })
  create(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(ApiClientInputSchema)) body: ApiClientInput,
  ): Promise<{ id: string; client: ApiClientView; key: IssuedApiKey }> {
    assertAllowlistPermitted(body.ipAllowlist);
    return createApiClient(body, user.userId);
  }

  @Patch(':id')
  @Authorized('api_clients:admin')
  @AuditLog({ action: 'api_client.update', entityType: 'ApiClient' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApiClientPatchSchema)) body: ApiClientPatch,
  ): Promise<ApiClientView> {
    assertAllowlistPermitted(body.ipAllowlist);
    const c = await updateApiClient(id, body);
    if (!c) throw new NotFoundException('API client not found');
    return c;
  }

  @Post(':id/keys')
  @Authorized('api_clients:admin')
  @AuditLog({ action: 'api_client.key.issue', entityType: 'ApiClient' })
  async issueKey(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(IssueKeySchema)) body: z.infer<typeof IssueKeySchema>,
  ): Promise<IssuedApiKey> {
    const k = await issueApiClientKey(id, user.userId, body.expiresAt ? new Date(body.expiresAt) : null);
    if (!k) throw new NotFoundException('API client not found');
    return k;
  }

  @Post(':id/keys/:keyId/revoke')
  @Authorized('api_clients:admin')
  @AuditLog({ action: 'api_client.key.revoke', entityType: 'ApiClient' })
  async revokeKey(
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Body(new ZodValidationPipe(RevokeKeySchema)) body: z.infer<typeof RevokeKeySchema>,
  ): Promise<ApiClientKeyView> {
    const k = await revokeApiClientKey(id, keyId, body.reason);
    if (!k) throw new NotFoundException('API key not found');
    return k;
  }
}
