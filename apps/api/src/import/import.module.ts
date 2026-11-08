import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports: [ConfigModule],
  controllers: [ImportController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
