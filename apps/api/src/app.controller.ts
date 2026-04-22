import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('/healthz')
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
