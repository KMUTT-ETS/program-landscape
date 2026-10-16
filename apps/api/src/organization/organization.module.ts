import { Module } from '@nestjs/common';
import { OrganizationAdminController, OrganizationPublicController } from './organization.controller';
import { BrandingStorageService } from './branding-storage.service';
import { OrganizationService } from './organization.service';

@Module({
  controllers: [OrganizationPublicController, OrganizationAdminController],
  providers: [OrganizationService, BrandingStorageService],
})
export class OrganizationModule {}
