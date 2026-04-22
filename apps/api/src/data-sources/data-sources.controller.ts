import { Controller, Get } from '@nestjs/common';
import { prisma } from '@kku/db';
import { Authorized } from '../common';

@Controller('/data-sources')
export class DataSourcesController {
  @Get()
  @Authorized('data_sources:read')
  async list() {
    return prisma.dataSource.findMany({ orderBy: { name: 'asc' } });
  }
}
