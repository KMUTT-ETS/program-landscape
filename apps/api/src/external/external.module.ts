import { Module } from '@nestjs/common';
import { StaffProfileController } from './staff-profile.controller';
import { StaffProfileService } from './staff-profile.service';

@Module({
  controllers: [StaffProfileController],
  providers: [StaffProfileService],
})
export class ExternalModule {}
