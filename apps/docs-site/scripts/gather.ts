import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGather } from '../src/gather';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

try {
  const { written } = runGather(repoRoot);
  console.log(`docs-site gather: wrote ${written.length} pages to docs/_generated/`);
} catch (err) {
  console.error(`docs-site gather failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
