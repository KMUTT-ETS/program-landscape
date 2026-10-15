import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { OrganizationIdentityInputSchema, type OrganizationIdentityInput, type SessionUser } from '@kku/shared';
import { AuditLog, AuthSession, Authorized, Provenance, Public, ZodValidationPipe } from '../common';
import { OrganizationService } from './organization.service';

const TcasMatchQuery = z.object({ name: z.string().trim().min(1).max(200) });

@Controller('/organization')
export class OrganizationPublicController {
  constructor(private readonly service: OrganizationService) {}

  /** Public: the sign-in page and the setup banner read this before any session exists. */
  @Get()
  @Public()
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async get() {
    return this.service.publicView();
  }
}

@Controller('/admin/organization')
export class OrganizationAdminController {
  constructor(private readonly service: OrganizationService) {}

  @Get()
  @Authorized('settings:configure')
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async get() {
    return this.service.adminView();
  }

  @Put()
  @Authorized('settings:configure')
  @AuditLog({ action: 'organization.update', entityType: 'OrganizationProfile' })
  async put(
    @Body(new ZodValidationPipe(OrganizationIdentityInputSchema)) body: OrganizationIdentityInput,
    @AuthSession() user: SessionUser,
  ) {
    return this.service.save(body, user.userId);
  }

  @Get('tcas-match')
  @Authorized('settings:configure')
  @Provenance({ sources: [{ id: 'tcas', name: 'TCAS admission statistics' }] })
  async tcasMatch(@Query(new ZodValidationPipe(TcasMatchQuery)) q: z.infer<typeof TcasMatchQuery>) {
    return this.service.tcasMatch(q.name);
  }
}
