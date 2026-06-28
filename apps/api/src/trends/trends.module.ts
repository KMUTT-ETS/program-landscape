import { Module } from '@nestjs/common';
import { TrendDocumentsModule } from '../trend-documents/trend-documents.module';
import { TrendsController } from './trends.controller';

@Module({ imports: [TrendDocumentsModule], controllers: [TrendsController] })
export class TrendsModule {}
