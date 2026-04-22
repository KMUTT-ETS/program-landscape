import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Respect X-Forwarded-For behind KKU's reverse proxy (for audit IPs).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`api listening on ${port}`);
}

void bootstrap();
