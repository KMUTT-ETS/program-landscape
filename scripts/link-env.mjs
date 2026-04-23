#!/usr/bin/env node
// Link the single root .env into each app that Next / Nest will cwd into.
// WHY: Next.js's @next/env only loads `.env` from the Next project dir
// (apps/web/), not the monorepo root. When the file isn't there, the
// Edge-runtime middleware bundle is compiled with NEXTAUTH_SECRET
// undefined and every protected route 307s back to /signin — even
// though the Node runtime (where signin itself runs) gets envs some
// other way. Same class of trap hits apps/api and apps/ingestion.
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
const apps = ['apps/web', 'apps/api', 'apps/ingestion'];

if (!existsSync(sourceEnv)) {
  console.warn(`[link-env] no .env at repo root (${sourceEnv}); skipping`);
  process.exit(0);
}

for (const app of apps) {
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
