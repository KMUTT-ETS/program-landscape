import { Module } from '@nestjs/common';
import { CockpitController } from './cockpit.controller';
import { CockpitService } from './cockpit.service';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [PdfModule],
  controllers: [CockpitController],
  providers: [CockpitService],
})
export class CockpitModule {}
