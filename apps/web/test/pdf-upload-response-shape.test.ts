import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The upload response is read by three separate client call sites. Only one
// of them was wrong, which is why the bug survived — the pattern looked
// right everywhere you happened to check. This pins the field name at both
// ends so a rename has to break loudly rather than at runtime, after the
// PDF has already been uploaded and orphaned.

const REPO = path.join(__dirname, '..', '..', '..');

describe('PDF upload response field name', () => {
  it('the API returns pdfDocumentId', () => {
    const svc = readFileSync(
      path.join(REPO, 'apps/api/src/pdf-intake/pdf-intake.service.ts'),
      'utf8',
    );
    expect(svc).toMatch(/pdfDocumentId:\s*string/);
  });

  it('no client call site reads a pdfDocument object', () => {
    const files = [
      'apps/web/app/admin/programs/new/client.tsx',
      'apps/web/app/admin/programs/[id]/client.tsx',
      'apps/web/app/admin/programs/from-pdf/client.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(path.join(REPO, f), 'utf8');
      expect(src, `${f} reads a pdfDocument object the API never returns`)
        .not.toMatch(/pdfDocument\s*\?\.\s*id/);
    }
  });
});
