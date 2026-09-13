import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DataSourcesModule } from '../data-sources/data-sources.module';
import { JobThaiController } from './jobthai.controller';
import { JobThaiService } from './jobthai.service';

@Module({
  imports: [ConfigModule, DataSourcesModule],
  controllers: [JobThaiController],
  providers: [JobThaiService],
})
export class JobThaiModule {}
