import { describe, expect, it } from 'vitest';
import { sanitizeMetadata } from '../src/storage/s3-storage';

// S3 user metadata rides on HTTP headers; Node rejects non-latin1 header
// values with ERR_INVALID_CHAR. Regression for the 2026-07-09 prod bug where
// every net-new PDF upload with a Thai filename 500'd at putObject.
describe('sanitizeMetadata', () => {
  it('URI-encodes Thai (non-ASCII) values', () => {
    const out = sanitizeMetadata({ originalFilename: 'หลักสูตรศึกษาศาสตรบัณฑิต 2565.pdf' });
    expect(out.originalFilename).toBe(encodeURIComponent('หลักสูตรศึกษาศาสตรบัณฑิต 2565.pdf'));
    // header-safe: every char printable ASCII
    expect(/^[\x20-\x7e]*$/.test(out.originalFilename)).toBe(true);
    // round-trips
    expect(decodeURIComponent(out.originalFilename)).toBe('หลักสูตรศึกษาศาสตรบัณฑิต 2565.pdf');
  });

  it('leaves plain-ASCII values untouched', () => {
    const out = sanitizeMetadata({ uploader: 'anonymous', hash: 'abc123', name: 'file (1).pdf' });
    expect(out).toEqual({ uploader: 'anonymous', hash: 'abc123', name: 'file (1).pdf' });
  });
});
