import { Module } from '@nestjs/common';
import { AdminDataSetupController } from './admin-data-setup.controller';

@Module({
  controllers: [AdminDataSetupController],
})
export class AdminDataSetupModule {}
