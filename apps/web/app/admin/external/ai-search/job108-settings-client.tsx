'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card } from '@kku/ui';
import { CheckCircle2, ExternalLink, Landmark } from 'lucide-react';
import {
  updateJob108SettingsAction,
  type Job108SettingsPatch,
  type Job108SettingsView,
} from '@/lib/actions/job108-settings';

// ─────────────────────────────────────────────────────────────────────────
// Job-108 (government announcements) settings panel — Task 17. Deliberately
// a SEPARATE panel from <AiSearchClient>'s ExternalAiSource table: job-108
// is not a row in that table (it is a dedicated Job108Connector — see
// apps/ingestion/src/connectors/sources/job-108/), so it does not belong in
// that CRUD list. This panel edits four `job108.*` SystemSetting rows via
// GET/PATCH /admin/job108-settings.
//
// The counting-window field carries the exact sentence the design decision
// requires, verbatim, as a permanently visible line (not a tooltip): the
// stored value is a DEFAULT only, a `publicWindowMonths` URL parameter
// always overrides it, and the Gap Analyzer's provenance drawer states the
// window every response was actually computed with. That is what makes
// exposing this field to an operator safe at all — no Council figure can
// move with no visible cause.
// ─────────────────────────────────────────────────────────────────────────

type FieldKey = keyof Job108SettingsView;

const FIELD_LABELS: Record<FieldKey, string> = {
  sitemapUrl: 'Sitemap URL',
  requestSpacingMs: 'Request spacing (ms)',
  maxAnnouncementsPerRun: 'Max announcements per run',
  defaultWindowMonths: 'Default counting window (months)',
};

/** The API's error message names the offending field by its key (e.g.
 *  "job108 sitemapUrl must be on ..." — see
 *  packages/db/src/job108-settings.ts's assertJob108SettingsValid). This
 *  maps that message back to the field so it renders inline, next to
 *  where it happened, rather than as a toast that names no field. Falls
 *  back to `null` (rendered as a page-level banner) when the message
 *  doesn't identify a field — e.g. a network error. */
function fieldForError(message: string): FieldKey | null {
  if (message.includes('sitemapUrl')) return 'sitemapUrl';
  if (message.includes('requestSpacingMs')) return 'requestSpacingMs';
  if (message.includes('maxAnnouncementsPerRun')) return 'maxAnnouncementsPerRun';
  if (message.includes('defaultWindowMonths')) return 'defaultWindowMonths';
  return null;
}

export function Job108SettingsPanel({ initial }: { initial: Job108SettingsView }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<Job108SettingsView>(initial);
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty =
    draft.sitemapUrl !== saved.sitemapUrl ||
    draft.requestSpacingMs !== saved.requestSpacingMs ||
    draft.maxAnnouncementsPerRun !== saved.maxAnnouncementsPerRun ||
    draft.defaultWindowMonths !== saved.defaultWindowMonths;

  function set<K extends FieldKey>(key: K, value: Job108SettingsView[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setJustSaved(false);
  }

  function save() {
    setFieldErrors({});
    setFormError(null);
    const patch: Job108SettingsPatch = {};
    for (const key of Object.keys(FIELD_LABELS) as FieldKey[]) {
      if (draft[key] !== saved[key]) (patch as Record<FieldKey, unknown>)[key] = draft[key];
    }
    if (Object.keys(patch).length === 0) return;

    startTransition(async () => {
      const res = await updateJob108SettingsAction(patch);
      if (!res.ok) {
        const field = fieldForError(res.message);
        if (field) setFieldErrors({ [field]: res.message });
        else setFormError(res.message);
        return;
      }
      setSaved(res.data);
      setDraft(res.data);
      setJustSaved(true);
      router.refresh();
    });
  }

  function reset() {
    setDraft(saved);
    setFieldErrors({});
    setFormError(null);
    setJustSaved(false);
  }

  return (
    <Card padding="sm">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Landmark className="size-icon-md text-text-tertiary" aria-hidden />
          <h2 className="text-sm font-semibold">Job-108 (government announcements)</h2>
        </div>
        <Badge tone="neutral">Connector</Badge>
      </div>
      <p className="mb-4 text-xs text-text-tertiary">
        This source is connector-backed, not an <code className="rounded bg-surface-2 px-1">ExternalAiSource</code>{' '}
        row above — it runs on its own weekly cadence. Its run history lives at{' '}
        <Link
          href="/admin/data-sources/job-108"
          className="inline-flex items-center gap-0.5 text-accent-default hover:underline"
        >
          /admin/data-sources/job-108 <ExternalLink className="size-icon-xs" aria-hidden />
        </Link>
        .
      </p>

      {formError ? (
        <div className="mb-3 rounded-lg border border-[oklch(var(--color-danger-default)/0.3)] bg-danger-default/5 p-3 text-sm text-danger-default">
          {formError}
        </div>
      ) : null}

      {justSaved && !dirty ? (
        <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-[oklch(var(--color-success-default)/0.3)] bg-success-default/5 p-3 text-sm text-success-default">
          <CheckCircle2 className="size-icon-sm" aria-hidden /> Saved.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SettingField
          label={FIELD_LABELS.sitemapUrl}
          hint="the connector's discovery URL"
          error={fieldErrors.sitemapUrl}
        >
          <input
            value={draft.sitemapUrl}
            onChange={(e) => set('sitemapUrl', e.target.value)}
            className="input"
            spellCheck={false}
          />
        </SettingField>

        <SettingField
          label={FIELD_LABELS.requestSpacingMs}
          hint="politeness delay between page fetches — minimum 1000ms"
          error={fieldErrors.requestSpacingMs}
        >
          <input
            type="number"
            min={1000}
            step={100}
            value={draft.requestSpacingMs}
            onChange={(e) => set('requestSpacingMs', Number(e.target.value) || 0)}
            className="input"
          />
        </SettingField>

        <SettingField
          label={FIELD_LABELS.maxAnnouncementsPerRun}
          hint="cap on one scheduled (weekly) run"
          error={fieldErrors.maxAnnouncementsPerRun}
        >
          <input
            type="number"
            min={1}
            value={draft.maxAnnouncementsPerRun}
            onChange={(e) => set('maxAnnouncementsPerRun', Number(e.target.value) || 0)}
            className="input"
          />
        </SettingField>

        <SettingField
          label={FIELD_LABELS.defaultWindowMonths}
          hint="Gap Analyzer public-demand counting window"
          error={fieldErrors.defaultWindowMonths}
        >
          <input
            type="number"
            min={1}
            value={draft.defaultWindowMonths}
            onChange={(e) => set('defaultWindowMonths', Number(e.target.value) || 0)}
            className="input"
          />
          <p className="mt-1.5 text-xs text-text-tertiary">
            Default only. A link carrying <code className="rounded bg-surface-2 px-1">publicWindowMonths</code>{' '}
            overrides it, and the Gap Analyzer&rsquo;s provenance drawer always states the window that page
            was computed with.
          </p>
        </SettingField>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={reset} disabled={pending || !dirty}>
          Discard changes
        </Button>
        <Button size="sm" onClick={save} disabled={pending || !dirty}>
          Save changes
        </Button>
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border-radius: 6px;
          border: 1px solid oklch(var(--color-border-default));
          background: oklch(var(--color-surface-0));
          padding: 6px 8px;
          font-size: 13px;
          color: oklch(var(--color-text-primary));
        }
      `}</style>
    </Card>
  );
}

function SettingField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-text-tertiary">{label}</span>
        {hint ? <span className="text-[11px] text-text-tertiary/80">{hint}</span> : null}
      </div>
      <div className="mt-1">{children}</div>
      {error ? (
        <p className="mt-1 text-xs text-danger-default" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}
