import { Module } from '@nestjs/common';
import { AiAdminController } from './ai-admin.controller';

@Module({ controllers: [AiAdminController] })
export class AiAdminModule {}
