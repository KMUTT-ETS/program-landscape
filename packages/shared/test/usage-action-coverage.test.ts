import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { actionFamily } from '../src/usage';

// An audit action that lands in `other` is invisible in the usage dashboard's
// action breakdown. This walks every @AuditLog decorator in the API (plus the
// two audit writers that live outside it) and fails until each action is
// classified — the cost of adding one is a rule in FAMILY_RULES or an entry
// below.

const ROOT = path.join(__dirname, '..', '..', '..');
const API_DIR = path.join(ROOT, 'apps', 'api', 'src');
// Audit rows written outside apps/api: sign-in outcomes and impersonation.
const EXTRA_SOURCES = [
  path.join(ROOT, 'packages', 'db', 'src', 'sign-in-lockout.ts'),
  path.join(ROOT, 'apps', 'web', 'src', 'lib', 'actions', 'impersonation.ts'),
];

// routine CRUD / configuration — not usage the dashboard reports; a new action
// must be classified in FAMILY_RULES or listed here
const DELIBERATELY_OTHER = new Set([
  'academic_year.set',
  'ai.extraction.approve',
  'ai.extraction.approve_all_pending',
  'ai.extraction.reject',
  'ai_model_override.clear',
  'ai_model_override.set',
  'api_client.create',
  'api_client.key.issue',
  'api_client.key.revoke',
  'api_client.update',
  'analyst.delete_all_conversations',
  'analyst.delete_conversation',
  'cockpit.delete_view',
  'cockpit.save_view',
  'create',
  'external_ai_source.create',
  'external_ai_source.delete',
  'external_ai_source.set_status',
  'external_ai_source.update',
  'gap_brief.disagreement',
  'ingestion.bulk_status',
  'ingestion.source_patched',
  'job_field.approve',
  'job_field.merge',
  'job_field.reject',
  'job_field.rename',
  'jobthai.batch.delete',
  'notifications.subscribe',
  'notifications.unsubscribe',
  'organization.asset_remove',
  'organization.asset_upload',
  'organization.brand_update',
  'organization.update',
  'pdf.delete',
  'pdf.extraction.approve',
  'pdf.extraction.approve_all_pending',
  'pdf.extraction.reject',
  'pdf.fix_filenames',
  'pdf.lifecycle.change',
  'peer_set.create',
  'program.apply_extraction',
  'program.create',
  'program.disagreement',
  'program.document.attach',
  'program.document.detach',
  'program.document.patch',
  'program.document.promote',
  'program.patch',
  'program.sunset',
  'program_job_field.add',
  'program_job_field.approve',
  'program_job_field.reject',
  'queue.clean',
  'queue.job.remove',
  'queue.job.retry',
  'queue.pause',
  'queue.resume',
  'scholar.profile.bind.self',
  'seed_catalog',
  'set_status',
  'trend.annotate',
  'trend.mark_reviewed',
  'trend_document.remove',
  'trend_signal.delete',
]);

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(full);
    return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
  });
}

// Scoped to the decorator body: a loose `action: '…'` also matches Helmet's
// `frameguard: { action: 'deny' }` in apps/api/src/main.ts.
function decoratorActions(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/@AuditLog\(\{([\s\S]*?)\}\)/g)) {
    const action = /\baction:\s*'([^']+)'/.exec(m[1]!);
    if (action) out.push(action[1]!);
  }
  return out;
}

// The out-of-tree writers pass the action as a plain property or a constant.
function looseActions(source: string): string[] {
  return [...source.matchAll(/(?:\baction:|_ACTION\s*=)\s*'([^']+)'/g)].map((m) => m[1]!);
}

const actions = [
  ...new Set([
    ...tsFiles(API_DIR).flatMap((f) => decoratorActions(readFileSync(f, 'utf8'))),
    ...EXTRA_SOURCES.flatMap((f) => looseActions(readFileSync(f, 'utf8'))),
  ]),
].sort();

describe('every audit action maps to a usage family', () => {
  it('found the audit actions to check', () => {
    expect(actions.length).toBeGreaterThan(80);
    expect(actions).not.toContain('deny'); // Helmet's frameguard, not an audit action
  });
  for (const action of actions) {
    it(`${action} is classified`, () => {
      const family = actionFamily(action);
      if (family === 'other') expect(DELIBERATELY_OTHER).toContain(action);
      else expect(family === null || family !== 'other').toBe(true);
    });
  }
});
