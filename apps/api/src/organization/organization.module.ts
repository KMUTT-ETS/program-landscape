import { Module } from '@nestjs/common';
import { OrganizationAdminController, OrganizationPublicController } from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({
  controllers: [OrganizationPublicController, OrganizationAdminController],
  providers: [OrganizationService],
})
export class OrganizationModule {}
