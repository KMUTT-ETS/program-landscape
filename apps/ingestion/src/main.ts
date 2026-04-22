import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  // eslint-disable-next-line no-console
  console.log('ingestion worker ready — connectors land in prompts 03 / 03b');
  await app.close();
}

void bootstrap();
