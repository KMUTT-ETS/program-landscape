import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Respect X-Forwarded-For behind KKU's reverse proxy (for audit IPs).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.enableShutdownHooks();

  // Dev CORS — in prod, nginx routes /api/* on the same host so CORS is
  // unused. The ALLOWED_ORIGINS env is tightened in prompt 13.
  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
      credentials: true,
    });
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`api listening on ${port}`);
}

void bootstrap();
