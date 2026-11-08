'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@kku/ui';
import {
  CheckCircle2,
  Globe2,
  Link as LinkIcon,
  Pause,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  createExternalAiSourceAction,
  deleteExternalAiSourceAction,
  runExternalAiSourceNowAction,
  setExternalAiSourceStatusAction,
  updateExternalAiSourceAction,
  type ExternalAiSignalType,
  type ExternalAiSourceKind,
  type ExternalAiSourceStatus,
} from '@/lib/actions/external-ai';

// ─────────────────────────────────────────────────────────────────────────
// AI search & synthesis admin client — Phase 5c.
// ─────────────────────────────────────────────────────────────────────────

export interface ExternalAiSourceRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: ExternalAiSourceKind;
  status: ExternalAiSourceStatus;
  configJson: unknown;
  cadenceCron: string | null;
  signalType: ExternalAiSignalType;
  defaultImpact: number;
  lastFetchedAt: string | null;
  lastFetchStatus: string | null;
  lastFetchError: string | null;
  lastSignalCount: number | null;
  recentSignalCount: number;
  createdAt: string;
  updatedAt: string;
}

const SIGNAL_TYPES: ExternalAiSignalType[] = ['POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS'];

const STATUS_TONES: Record<ExternalAiSourceStatus, 'success' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  DISABLED: 'neutral',
};

interface EditDraft {
  id?: string;
  slug: string;
  name: string;
  description: string;
  kind: ExternalAiSourceKind;
  signalType: ExternalAiSignalType;
  defaultImpact: number;
  cadenceCron: string;
  // URL_LIST: one URL per line; WEB_SEARCH: one query per line
  configText: string;
  maxResultsPerQuery: number;
}

function emptyDraft(): EditDraft {
  return {
    slug: '',
    name: '',
    description: '',
    kind: 'URL_LIST',
    signalType: 'NEWS',
    defaultImpact: 0.5,
    cadenceCron: '',
    configText: '',
    maxResultsPerQuery: 5,
  };
}

function rowToDraft(r: ExternalAiSourceRow): EditDraft {
  const cfg = (r.configJson ?? {}) as Record<string, unknown>;
  const lines =
    r.kind === 'URL_LIST'
      ? Array.isArray(cfg.urls)
        ? (cfg.urls as unknown[]).filter((x): x is string => typeof x === 'string').join('\n')
        : ''
      : Array.isArray(cfg.queries)
        ? (cfg.queries as unknown[]).filter((x): x is string => typeof x === 'string').join('\n')
        : '';
  const maxResults =
    typeof cfg.maxResultsPerQuery === 'number' ? (cfg.maxResultsPerQuery as number) : 5;
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description ?? '',
    kind: r.kind,
    signalType: r.signalType,
    defaultImpact: r.defaultImpact,
    cadenceCron: r.cadenceCron ?? '',
    configText: lines,
    maxResultsPerQuery: maxResults,
  };
}

function draftToConfig(draft: EditDraft): Record<string, unknown> {
  const lines = draft.configText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (draft.kind === 'URL_LIST') return { urls: lines };
  return { queries: lines, provider: 'google_cse', maxResultsPerQuery: draft.maxResultsPerQuery };
}

export function AiSearchClient({ initial }: { initial: ExternalAiSourceRow[] }) {
  const router = useRouter();
  const [sources] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [runResult, setRunResult] = useState<null | {
    sourceName: string;
    fetched: number;
    summarised: number;
    skipped: number;
    failures: number;
  }>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExternalAiSourceRow | null>(null);

  const totals = useMemo(() => {
    return sources.reduce(
      (acc, s) => ({
        total: acc.total + 1,
        active: acc.active + (s.status === 'ACTIVE' ? 1 : 0),
        recentSignals: acc.recentSignals + s.recentSignalCount,
      }),
      { total: 0, active: 0, recentSignals: 0 },
    );
  }, [sources]);

  function setStatus(row: ExternalAiSourceRow, status: ExternalAiSourceStatus) {
    setError(null);
    startTransition(async () => {
      const res = await setExternalAiSourceStatusAction(row.id, status);
      if (!res.ok) setError(res.message);
      else router.refresh();
    });
  }

  function runNow(row: ExternalAiSourceRow) {
    setError(null);
    setRunResult(null);
    startTransition(async () => {
      const res = await runExternalAiSourceNowAction(row.id);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setRunResult({
        sourceName: row.name,
        fetched: res.result.fetched,
        summarised: res.result.summarised,
        skipped: res.result.skipped,
        failures: res.result.failures,
      });
      router.refresh();
    });
  }

  function saveDraft(draft: EditDraft) {
    setError(null);
    startTransition(async () => {
      const configJson = draftToConfig(draft);
      const res = draft.id
        ? await updateExternalAiSourceAction(draft.id, {
            name: draft.name,
            description: draft.description || null,
            configJson,
            cadenceCron: draft.cadenceCron || null,
            signalType: draft.signalType,
            defaultImpact: draft.defaultImpact,
          })
        : await createExternalAiSourceAction({
            slug: draft.slug,
            name: draft.name,
            description: draft.description || undefined,
            kind: draft.kind,
            configJson,
            cadenceCron: draft.cadenceCron || undefined,
            signalType: draft.signalType,
            defaultImpact: draft.defaultImpact,
          });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function doDelete(row: ExternalAiSourceRow) {
    setError(null);
    startTransition(async () => {
      const res = await deleteExternalAiSourceAction(row.id);
      if (!res.ok) setError(res.message);
      else router.refresh();
      setConfirmDelete(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-lg border border-danger-default/30 bg-danger-default/5 p-3 text-sm text-danger-default">
          {error}
        </div>
      ) : null}

      {runResult ? (
        <div className="rounded-lg border border-success-default/30 bg-success-default/5 p-3 text-sm">
          <strong>{runResult.sourceName}</strong> — fetched {runResult.fetched}, summarised{' '}
          {runResult.summarised}, skipped {runResult.skipped}, failed {runResult.failures}.
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Sources" value={String(totals.total)} sub="in catalog" />
        <SummaryCard label="Active" value={String(totals.active)} sub="firing on cadence" />
        <SummaryCard label="Signals (30d)" value={String(totals.recentSignals)} sub="from this catalog" />
      </div>

      <Card padding="sm">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Source catalog</h2>
          <Button size="sm" onClick={() => setEditing(emptyDraft())} disabled={pending}>
            <Plus className="size-icon-sm" aria-hidden /> Add source
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-text-tertiary">
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Cadence</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last fetch</th>
                <th className="px-3 py-2 text-right font-medium">Signals (30d)</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-t border-border-default align-top">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {s.kind === 'WEB_SEARCH' ? (
                        <Search className="size-icon-sm text-text-tertiary" aria-hidden />
                      ) : (
                        <LinkIcon className="size-icon-sm text-text-tertiary" aria-hidden />
                      )}
                      <span className="font-medium">{s.name}</span>
                      <Badge tone="neutral">{s.signalType}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-text-tertiary">
                      <code className="rounded bg-surface-2 px-1">{s.slug}</code>
                      {s.description ? <span className="ml-1">— {s.description}</span> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <Badge tone="neutral">{s.kind.replace('_', ' ')}</Badge>
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px] text-text-secondary">
                    {s.cadenceCron ?? '—'}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={STATUS_TONES[s.status]}>{s.status}</Badge>
                  </td>
                  <td className="px-3 py-3 text-xs text-text-tertiary">
                    {s.lastFetchedAt ? (
                      <>
                        <div>{new Date(s.lastFetchedAt).toLocaleString()}</div>
                        <div className="mt-0.5 flex items-center gap-1">
                          {s.lastFetchStatus === 'OK' ? (
                            <CheckCircle2 className="size-icon-xs text-success-default" aria-hidden />
                          ) : s.lastFetchStatus === 'FAILED' ? (
                            <XCircle className="size-icon-xs text-danger-default" aria-hidden />
                          ) : null}
                          <span>
                            {s.lastFetchStatus ?? '—'} · {s.lastSignalCount ?? 0} new
                          </span>
                        </div>
                        {s.lastFetchError ? (
                          <div className="mt-0.5 max-w-[220px] truncate text-warning-default" title={s.lastFetchError}>
                            {s.lastFetchError}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-text-tertiary">Never run</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{s.recentSignalCount}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => runNow(s)}
                        disabled={pending || s.status === 'DISABLED'}
                        title="Run now"
                      >
                        <RefreshCw className="size-icon-sm" aria-hidden />
                      </Button>
                      {s.status === 'ACTIVE' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setStatus(s, 'PAUSED')}
                          disabled={pending}
                          title="Pause"
                        >
                          <Pause className="size-icon-sm" aria-hidden />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setStatus(s, 'ACTIVE')}
                          disabled={pending}
                          title="Activate"
                        >
                          <Play className="size-icon-sm" aria-hidden />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(rowToDraft(s))}
                        disabled={pending}
                        title="Edit"
                      >
                        <PencilLine className="size-icon-sm" aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDelete(s)}
                        disabled={pending}
                        title="Delete"
                        className="text-danger-default hover:text-danger-default"
                      >
                        <Trash2 className="size-icon-sm" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {sources.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-text-tertiary">
                    No sources yet — click <strong>Add source</strong> to start.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-text-tertiary">
        Run-now fetches every URL / executes every query immediately and AI-summarises each result.
        Cadence-driven scheduling lands in a follow-up (the seeded sources stay <em>paused</em> until you flip them).
      </p>

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          {editing ? (
            <EditDraftForm
              draft={editing}
              isEdit={Boolean(editing.id)}
              pending={pending}
              onChange={setEditing}
              onSave={() => saveDraft(editing)}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete != null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          {confirmDelete ? (
            <>
              <DialogHeader>
                <DialogTitle>Delete source?</DialogTitle>
                <DialogDescription>
                  <span className="block font-medium text-text-primary">{confirmDelete.name}</span>
                  <span className="mt-1 block text-text-tertiary">
                    Existing TrendSignal rows from this source are preserved (their
                    externalAiSourceId becomes NULL). The source row is permanently
                    removed.
                  </span>
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => doDelete(confirmDelete)}
                  disabled={pending}
                  className="bg-danger-default text-text-on-danger hover:bg-danger-default/90"
                >
                  <Trash2 className="size-icon-sm" aria-hidden /> Delete
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditDraftForm({
  draft,
  isEdit,
  pending,
  onChange,
  onSave,
  onCancel,
}: {
  draft: EditDraft;
  isEdit: boolean;
  pending: boolean;
  onChange: (d: EditDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Globe2 className="size-icon-md" aria-hidden />
          {isEdit ? `Edit ${draft.name || draft.slug}` : 'Add external AI source'}
        </DialogTitle>
        <DialogDescription>
          {draft.kind === 'URL_LIST'
            ? 'One URL per line. Each URL is fetched on cadence + summarised by the LLM.'
            : 'One query per line. Each query is sent to the configured search provider.'}
        </DialogDescription>
      </DialogHeader>
      <div className="mt-2 flex flex-col gap-3 text-sm">
        {!isEdit ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Slug" hint="lowercase-kebab, used in URLs">
              <input
                value={draft.slug}
                onChange={(e) => onChange({ ...draft, slug: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Kind">
              <select
                value={draft.kind}
                onChange={(e) => onChange({ ...draft, kind: e.target.value as ExternalAiSourceKind })}
                className="input"
              >
                <option value="URL_LIST">URL list</option>
                <option value="WEB_SEARCH">Web search</option>
              </select>
            </Field>
          </div>
        ) : null}
        <Field label="Display name">
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            rows={2}
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
            className="input"
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Default signalType">
            <select
              value={draft.signalType}
              onChange={(e) =>
                onChange({ ...draft, signalType: e.target.value as ExternalAiSignalType })
              }
              className="input"
            >
              {SIGNAL_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default impact" hint="0.0 – 1.0">
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={draft.defaultImpact}
              onChange={(e) =>
                onChange({ ...draft, defaultImpact: Number(e.target.value) || 0 })
              }
              className="input"
            />
          </Field>
          <Field label="Cron (optional)" hint="cadence schedule">
            <input
              value={draft.cadenceCron}
              onChange={(e) => onChange({ ...draft, cadenceCron: e.target.value })}
              placeholder="0 8 * * 1"
              className="input"
            />
          </Field>
        </div>
        <Field
          label={draft.kind === 'URL_LIST' ? 'URLs' : 'Search queries'}
          hint="one per line"
        >
          <textarea
            rows={6}
            value={draft.configText}
            onChange={(e) => onChange({ ...draft, configText: e.target.value })}
            placeholder={
              draft.kind === 'URL_LIST'
                ? 'https://www.weforum.org/agenda/...\nhttps://...'
                : 'มหาวิทยาลัย เปิดหลักสูตรใหม่\nThailand higher education policy 2026'
            }
            className="input font-mono text-xs"
          />
        </Field>
        {draft.kind === 'WEB_SEARCH' ? (
          <Field label="Max results per query">
            <input
              type="number"
              min="1"
              max="10"
              value={draft.maxResultsPerQuery}
              onChange={(e) =>
                onChange({ ...draft, maxResultsPerQuery: Number(e.target.value) || 5 })
              }
              className="input"
            />
          </Field>
        ) : null}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={pending || !draft.name || !draft.slug}>
          {isEdit ? 'Save changes' : 'Create source'}
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
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-text-tertiary">{label}</span>
        {hint ? <span className="text-[11px] text-text-tertiary/80">{hint}</span> : null}
      </div>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="mt-1 text-2xl font-medium tabular-nums">{value}</div>
      <div className="text-xs text-text-tertiary">{sub}</div>
    </Card>
  );
}
