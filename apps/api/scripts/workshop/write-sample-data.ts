// Writes the workshop sample dataset to workshop/sample-data/.
//
// Usage: pnpm workshop:sample-data

import fs from 'node:fs';
import path from 'node:path';
import { SAMPLE_UPLOAD_ORDER, buildSampleRows, buildSampleWorkbook, sampleFilename } from './sample-data';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const outDir = path.join(repoRoot, 'workshop', 'sample-data');
fs.mkdirSync(outDir, { recursive: true });

for (const slug of SAMPLE_UPLOAD_ORDER) {
  const file = path.join(outDir, sampleFilename(slug));
  fs.writeFileSync(file, buildSampleWorkbook(slug));
  console.log(`${sampleFilename(slug)}  ${buildSampleRows(slug).length} rows`);
}
