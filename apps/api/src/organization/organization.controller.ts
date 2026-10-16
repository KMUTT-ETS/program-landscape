import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ApiError,
  BRAND_ASSET_KINDS,
  OrganizationBrandInputSchema,
  OrganizationIdentityInputSchema,
  type OrganizationBrandInput,
  type OrganizationIdentityInput,
  type SessionUser,
} from '@kku/shared';
import { AuditLog, AuthSession, Authorized, Provenance, Public, ZodValidationPipe } from '../common';
import { MAX_ASSET_BYTES } from './asset-validation';
import { OrganizationService } from './organization.service';

const AssetKindParam = z.object({ kind: z.enum(BRAND_ASSET_KINDS) });
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

  @Put('brand')
  @Authorized('settings:configure')
  @AuditLog({ action: 'organization.brand_update', entityType: 'OrganizationProfile' })
  async putBrand(
    @Body(new ZodValidationPipe(OrganizationBrandInputSchema)) body: OrganizationBrandInput,
    @AuthSession() user: SessionUser,
  ) {
    return this.service.saveBrand(body, user.userId);
  }

  @Post('assets/:kind')
  @Authorized('settings:configure')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ASSET_BYTES + 1, files: 1, fields: 0, parts: 2 } }))
  @AuditLog({ action: 'organization.asset_upload', entityType: 'OrganizationProfile' })
  async uploadAsset(
    @Param(new ZodValidationPipe(AssetKindParam)) p: z.infer<typeof AssetKindParam>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @AuthSession() user: SessionUser,
    @Req() req: Request,
  ) {
    if (!file) throw new ApiError('VALIDATION_FAILED', 'No file uploaded (field "file").');
    const result = await this.service.uploadAsset(p.kind, file.buffer, user.userId);
    // The audit interceptor logs req.body (empty for multipart): record the facts there.
    // `storageKey`, not `key`: the interceptor redacts any field starting with "key".
    req.body = result.asset;
    return result;
  }

  @Delete('assets/:kind')
  @Authorized('settings:configure')
  @AuditLog({ action: 'organization.asset_remove', entityType: 'OrganizationProfile' })
  async removeAsset(
    @Param(new ZodValidationPipe(AssetKindParam)) p: z.infer<typeof AssetKindParam>,
    @AuthSession() user: SessionUser,
    @Req() req: Request,
  ) {
    const result = await this.service.removeAsset(p.kind, user.userId);
    req.body = { kind: p.kind };
    return result;
  }

  @Get('tcas-match')
  @Authorized('settings:configure')
  @Provenance({ sources: [{ id: 'tcas', name: 'TCAS admission statistics' }] })
  async tcasMatch(@Query(new ZodValidationPipe(TcasMatchQuery)) q: z.infer<typeof TcasMatchQuery>) {
    return this.service.tcasMatch(q.name);
  }
}
