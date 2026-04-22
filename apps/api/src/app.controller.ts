import { Controller, Get } from '@nestjs/common';
import { Public } from './common';

@Controller()
export class AppController {
  @Get('/healthz')
  @Public()
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
