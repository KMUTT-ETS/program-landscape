import { Module } from '@nestjs/common';
import { PdfIntakeController } from './pdf-intake.controller';
import { PdfIntakeService } from './pdf-intake.service';
import { PdfIntakeQueueService } from './pdf-intake-queue.service';

@Module({
  controllers: [PdfIntakeController],
  providers: [PdfIntakeService, PdfIntakeQueueService],
  exports: [PdfIntakeService, PdfIntakeQueueService],
})
export class PdfIntakeModule {}
