import { Module } from '@nestjs/common';
import { AdminDataSetupController } from './admin-data-setup.controller';
import { AdminDataSetupRawController } from './raw-data.controller';

@Module({
  controllers: [AdminDataSetupController, AdminDataSetupRawController],
})
export class AdminDataSetupModule {}
