// pnpm workshop:mock-api <dir> [--port 4010] [--token <t>] [--host 127.0.0.1]
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { parseArgs } from 'node:util';
import { buildRoutes, loadMockSource } from './routes';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', default: '4010' },
      token: { type: 'string' },
      host: { type: 'string', default: '127.0.0.1' },
    },
  });
  const dir = positionals[0];
  if (!dir) {
    console.error('Usage: pnpm workshop:mock-api <mock output folder> [--port 4010] [--token <t>]');
    process.exit(2);
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Bad --port: ${values.port}`);
    process.exit(2);
  }
  const token = values.token ?? randomBytes(12).toString('hex');
  const source = await loadMockSource(dir);
  const server = http.createServer(buildRoutes(source, token));
  server.listen(port, values.host, () => {
    const addr = server.address();
    const actual = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`Mock institution API: http://${values.host}:${actual}/api/v1`);
    console.log(`Token: ${token}`);
    console.log(
      `${source.classOfferings.length} class sections, ${source.enrollment.length} intake rows. Ctrl+C to stop.`,
    );
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
