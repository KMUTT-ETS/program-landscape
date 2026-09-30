import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { ApiMeta, StaffProfileResponseData } from '@kku/shared';
import { ApiKeyAuth, type ApiClientRequest } from './api-key.guard';
import { StaffProfileService } from './staff-profile.service';

/**
 * POST /api/v1/external/staff-profile — staff-profile.v1.
 * POST, not GET: a citizen id in a query string would land in every proxy
 * and access log on the way. Consumer guide: docs/integrations/staff-profile-api.md
 */
@Controller('/external/staff-profile')
export class StaffProfileController {
  constructor(private readonly service: StaffProfileService) {}

  @Post()
  @HttpCode(200)
  @ApiKeyAuth()
  lookup(
    @Req() req: ApiClientRequest,
    @Body() body: unknown,
  ): Promise<{ data: StaffProfileResponseData; meta: Partial<ApiMeta> }> {
    return this.service.lookup(req, body);
  }
}
