import { Module } from '@nestjs/common';
import { AunqaController } from './aunqa.controller';
import { AunqaService } from './aunqa.service';

@Module({
  controllers: [AunqaController],
  providers: [AunqaService],
  exports: [AunqaService],
})
export class AunqaModule {}
