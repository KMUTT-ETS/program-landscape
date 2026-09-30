import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { CacheService } from '../src/common/cache.service';

function withClient(client: unknown): CacheService {
  const config = { get: () => undefined } as unknown as ConfigService;
  const svc = new CacheService(config); // REDIS_URL unset → no client
  (svc as unknown as { client: unknown }).client = client;
  return svc;
}

describe('CacheService.incrWindow', () => {
  it('returns the new count and sets the TTL only on the first hit', async () => {
    const client = { incr: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2), expire: vi.fn() };
    const svc = withClient(client);
    await expect(svc.incrWindow('rl:a', 120)).resolves.toBe(1);
    await expect(svc.incrWindow('rl:a', 120)).resolves.toBe(2);
    expect(client.expire).toHaveBeenCalledTimes(1);
    expect(client.expire).toHaveBeenCalledWith('kku:cache:rl:a', 120);
  });
  it('returns undefined when Redis is unavailable', async () => {
    await expect(withClient(null).incrWindow('rl:a', 120)).resolves.toBeUndefined();
    const failing = withClient({ incr: vi.fn().mockRejectedValue(new Error('down')), expire: vi.fn() });
    await expect(failing.incrWindow('rl:a', 120)).resolves.toBeUndefined();
  });
});
