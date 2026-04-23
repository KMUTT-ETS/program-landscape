import { Module } from '@nestjs/common';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';

// Stays a thin NestJS shell — wiring only. The actual rendering logic
// lives in @kku/shared's PdfGenerationService so that CLI tools and
// tests can use the same service without spinning up Nest.
@Module({
  controllers: [PdfController],
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
