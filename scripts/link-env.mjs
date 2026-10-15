#!/usr/bin/env node
// Link the single root .env into every package that cwd's into its own dir
// and resolves env from there.
// WHY: Next.js's @next/env only loads `.env` from the Next project dir
// (apps/web/), not the monorepo root. When the file isn't there, the
// Edge-runtime middleware bundle is compiled with NEXTAUTH_SECRET
// undefined and every protected route 307s back to /signin — even
// though the Node runtime (where signin itself runs) gets envs some
// other way. Same class of trap hits apps/api and apps/ingestion.
// packages/db needs it too: the Prisma CLI (`prisma migrate deploy`,
// `prisma generate`) runs with cwd=packages/db and only auto-loads a
// `.env` from there, so without it DATABASE_URL is undefined.
//
// On Linux/macOS we create a relative symlink. On Windows (where
// symlinks require admin or Developer Mode), we fall back to copying
// the file. The copy drifts if root .env is edited — the symlink
// path is preferred.

import { existsSync, lstatSync, unlinkSync, symlinkSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceEnv = path.join(root, '.env');
const targets = ['apps/web', 'apps/api', 'apps/ingestion', 'packages/db'];

if (!existsSync(sourceEnv)) {
  console.warn(`[link-env] no .env at repo root (${sourceEnv}); skipping`);
  process.exit(0);
}

for (const app of targets) {
  const target = path.join(root, app, '.env');
  if (existsSync(target) || (() => { try { return lstatSync(target).isSymbolicLink(); } catch { return false; } })()) {
    try { unlinkSync(target); } catch { /* ignore */ }
  }
  const relative = path.relative(path.dirname(target), sourceEnv);
  try {
    symlinkSync(relative, target, 'file');
    console.log(`[link-env] ${app}/.env → ${relative}`);
  } catch (err) {
    if (err?.code === 'EPERM' || err?.code === 'EACCES') {
      copyFileSync(sourceEnv, target);
      console.log(`[link-env] ${app}/.env (copied; enable Developer Mode on Windows for symlinks)`);
    } else {
      throw err;
    }
  }
}
