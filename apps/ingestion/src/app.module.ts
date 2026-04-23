import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import path from 'node:path';

import { IngestionService } from './ingestion.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        // Repo root .env (dev), falling back to apps/ingestion/.env.
        path.join(process.cwd(), '..', '..', '.env'),
        path.join(process.cwd(), '.env'),
      ],
    }),
  ],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class AppModule {}
