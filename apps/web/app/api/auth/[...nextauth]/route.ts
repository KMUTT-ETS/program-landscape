import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;

// Run on the Node.js runtime — the auth callbacks call Prisma.
export const runtime = 'nodejs';
