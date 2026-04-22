import * as jose from 'jose';

// Custom JWT encode/decode for next-auth v5 using HS256 (signed, not
// encrypted). The NestJS API verifies with the same secret and algorithm.
// By default next-auth uses JWE; switching to signed JWT makes cross-
// service verification trivial without decryption keys.

function secretKey(secret: string | string[] | undefined): Uint8Array {
  const raw = Array.isArray(secret) ? secret[0] : secret;
  if (!raw) throw new Error('NEXTAUTH_SECRET is required for jwt-codec');
  return new TextEncoder().encode(raw);
}

export async function encodeJwt(params: {
  token?: unknown;
  secret: string | string[];
  maxAge?: number;
}): Promise<string> {
  const { token, secret, maxAge = 30 * 24 * 60 * 60 } = params;
  if (!token) return '';
  const key = secretKey(secret);
  return await new jose.SignJWT(token as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
    .sign(key);
}

export async function decodeJwt(params: {
  token?: string;
  secret: string | string[];
}): Promise<Record<string, unknown> | null> {
  const { token, secret } = params;
  if (!token) return null;
  const key = secretKey(secret);
  try {
    const { payload } = await jose.jwtVerify(token, key, {
      algorithms: ['HS256'],
    });
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}
