'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
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
import { ArrowRightLeft, Check, Cog, Lock, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
// Type-only — erased at compile time, so this does NOT pull @kku/shared's
// runtime barrel (and its node:crypto import) into the client bundle. See
// memory: kku_shared_barrel_client.
import type { MethodModelHealth } from '@kku/shared';
import {
  clearAiModelOverrideAction,
  refreshAiModelsAction,
  setAiModelOverrideAction,
  swapAiModelsAction,
  type SwapCandidate,
  type SwapPlan,
} from '@/lib/actions/ai-settings';
import { shouldAcceptSwapPreview, canApplySwapPreview } from '@/lib/ai-settings-swap-guard';

// ─────────────────────────────────────────────────────────────────────────
// Mirror of apps/api/src/admin/ai-settings.service.ts.
// Re-declared client-side so we don't have to import @kku/shared (which
// drags node:crypto via its barrel). See memory: kku_shared_barrel_client.
// ─────────────────────────────────────────────────────────────────────────

export interface AiSettingsMethodRow {
  methodPrefix: string;
  currentVersion: string;
  label: string;
  description: string;
  module: string;
  tier: string;
  defaultModel: string;
  effectiveModel: string;
  override: null | {
    modelId: string;
    setByUserId: string | null;
    setByUserName: string | null;
    updatedAt: string;
  };
  /** When non-null this method is hard-locked — the picker is hidden
   *  and any DB override is ignored at runtime. */
  lockedModel: string | null;
  lockReason: string | null;
  thirtyDayCost: number;
  thirtyDayCalls: number;
}

export interface AiSettingsModel {
  id: string;
  label: string;
  provider: 'google' | 'anthropic';
  tier: 'pro' | 'flash' | 'sonnet' | 'haiku' | 'opus';
  description: string;
  costInputPer1m: number;
  costOutputPer1m: number;
  legacy?: boolean;
  /** 'openrouter' (Gemini, cron-refreshed) | 'static' (Anthropic, seeded). */
  source?: string;
}

/** A model choosable as the SOURCE of a bulk swap — wider than `models`
 *  (the catalog-backed target list): the "from" list is what is CURRENTLY
 *  RUNNING — the distinct effectiveModel across all methods — because a model
 *  that stopped working is exactly the kind that has already dropped out of
 *  the daily-refreshed OpenRouter catalog, and a catalog model no method uses
 *  is not a swap source at all. See ai-settings.service.ts. */
export interface SwapSourceModelOption {
  id: string;
  label: string;
  inCatalog: boolean;
  /** How many methods currently run on this model. */
  methodCount: number;
}

export interface AiSettingsResponse {
  methods: AiSettingsMethodRow[];
  models: AiSettingsModel[];
  modelCatalog: {
    lastFetchedAt: string | null;
    openrouterCount: number;
    staticCount: number;
  };
  /** Per-method model-pin verdict from the shared `aiModelHealth()`
   *  resolver. Rendered by <ModelHealthBanner> in the server-component
   *  page above this client, not here — kept on the response type only
   *  so `data.health` type-checks at the call site. */
  health: MethodModelHealth[];
  /** Choices for the bulk-swap "from" dropdown. */
  fromModelOptions: SwapSourceModelOption[];
}

const MODULE_LABELS: Record<string, string> = {
  pipeline: 'Program pipeline',
  cockpit: 'Cockpit',
  gap: 'Gap analyzer',
  scenarios: 'Scenarios',
  decisions: 'Decisions',
  benchmarking: 'Benchmarking',
  analyst: 'AI analyst',
  ingestion: 'Ingestion',
  profile: 'Profile',
  trends: 'Trends radar',
  teaching: 'Teaching & learning',
};

const MODULE_ORDER = [
  'pipeline',
  'cockpit',
  'gap',
  'scenarios',
  'decisions',
  'benchmarking',
  'analyst',
  'profile',
  'ingestion',
];

const TIER_TONES: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  reasoning: 'info',
  narrative: 'success',
  extraction: 'warning',
  classification: 'neutral',
  embedding: 'neutral',
};

export function AiSettingsClient({ initial }: { initial: AiSettingsResponse }) {
  const [data, setData] = useState<AiSettingsResponse>(initial);
  const [editing, setEditing] = useState<AiSettingsMethodRow | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  // Bulk swap — "replace every method using model X with model Y."
  const [swapFrom, setSwapFrom] = useState('');
  const [swapTo, setSwapTo] = useState('');
  // Refs mirror swapFrom/swapTo so a still-in-flight preview response can
  // be checked against the LATEST selection at the moment it lands, not
  // the (possibly stale) closure captured when the request was fired.
  const swapFromRef = useRef('');
  const swapToRef = useRef('');
  const [swapPreview, setSwapPreview] = useState<{
    fromModelId: string;
    toModelId: string;
    plan: SwapPlan;
  } | null>(null);
  const [swapPending, startSwapTransition] = useTransition();
  const [swapError, setSwapError] = useState<string | null>(null);

  async function refreshModels() {
    setRefreshing(true);
    try {
      const res = await refreshAiModelsAction();
      if (!res.ok) {
        toast.error(`Model refresh failed: ${res.message}`);
        return;
      }
      if (res.warning) {
        toast.warning('OpenRouter unavailable — kept the existing model catalog.');
      } else {
        toast.success(
          `Refreshed ${res.count} Gemini model${res.count === 1 ? '' : 's'} from OpenRouter.`,
        );
      }
      router.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const grouped = useMemo(() => {
    const byModule = new Map<string, AiSettingsMethodRow[]>();
    for (const row of data.methods) {
      const arr = byModule.get(row.module) ?? [];
      arr.push(row);
      byModule.set(row.module, arr);
    }
    return MODULE_ORDER.filter((m) => byModule.has(m)).map((m) => ({
      module: m,
      label: MODULE_LABELS[m] ?? m,
      rows: byModule.get(m)!,
    }));
  }, [data]);

  const totals = useMemo(() => {
    return data.methods.reduce(
      (acc, m) => ({
        cost: acc.cost + m.thirtyDayCost,
        calls: acc.calls + m.thirtyDayCalls,
        overrides: acc.overrides + (m.override ? 1 : 0),
      }),
      { cost: 0, calls: 0, overrides: 0 },
    );
  }, [data]);

  function applyRow(updated: AiSettingsMethodRow) {
    setData((d) => ({
      ...d,
      methods: d.methods.map((m) => (m.methodPrefix === updated.methodPrefix ? updated : m)),
    }));
  }

  function setOverride(prefix: string, modelId: string) {
    setError(null);
    startTransition(async () => {
      const res = await setAiModelOverrideAction(prefix, modelId);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      // Optimistic: refetch latest by reloading via revalidatePath.
      // Quick local patch so the UI reflects immediately.
      setData((d) => ({
        ...d,
        methods: d.methods.map((m) =>
          m.methodPrefix === prefix
            ? {
                ...m,
                effectiveModel: modelId,
                override: {
                  modelId,
                  setByUserId: null,
                  setByUserName: 'you',
                  updatedAt: new Date().toISOString(),
                },
              }
            : m,
        ),
      }));
      setEditing(null);
    });
  }

  function clearOverride(prefix: string) {
    setError(null);
    const defaultModel = data.methods.find((m) => m.methodPrefix === prefix)?.defaultModel;
    if (!defaultModel) return;
    startTransition(async () => {
      const res = await clearAiModelOverrideAction(prefix);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setData((d) => ({
        ...d,
        methods: d.methods.map((m) =>
          m.methodPrefix === prefix
            ? { ...m, effectiveModel: defaultModel, override: null }
            : m,
        ),
      }));
    });
  }

  function updateSwapFrom(value: string) {
    swapFromRef.current = value;
    setSwapFrom(value);
    setSwapPreview(null);
    setSwapError(null);
  }

  function updateSwapTo(value: string) {
    swapToRef.current = value;
    setSwapTo(value);
    setSwapPreview(null);
    setSwapError(null);
  }

  function previewSwap() {
    if (!swapFrom || !swapTo) return;
    setSwapError(null);
    const requestFrom = swapFrom;
    const requestTo = swapTo;
    startSwapTransition(async () => {
      const res = await swapAiModelsAction(requestFrom, requestTo, false);
      if (!res.ok) {
        setSwapError(res.message);
        return;
      }
      // CRITICAL-1 guard: the operator may have changed the dropdowns
      // while this request was in flight. The selects are also disabled
      // during swapPending (belt), but this check (braces) catches the
      // response landing in the gap after re-enabling. Compare against
      // the refs (updated synchronously by updateSwapFrom/updateSwapTo),
      // not swapFrom/swapTo — those are this closure's stale values.
      if (!shouldAcceptSwapPreview(res, swapFromRef.current, swapToRef.current)) return;
      setSwapPreview({ fromModelId: res.fromModelId, toModelId: res.toModelId, plan: res.plan });
    });
  }

  const swapChangeCount = swapPreview
    ? swapPreview.plan.rewrite.length + swapPreview.plan.create.length
    : 0;
  const canApplySwap = canApplySwapPreview(
    swapPreview ? { ...swapPreview, changeCount: swapChangeCount } : null,
    swapFrom,
    swapTo,
    swapPending,
  );

  function applySwap() {
    if (!swapPreview) return;
    if (!canApplySwapPreview({ ...swapPreview, changeCount: swapChangeCount }, swapFrom, swapTo, swapPending)) {
      return;
    }
    setSwapError(null);
    const { fromModelId, toModelId } = swapPreview;
    startSwapTransition(async () => {
      const res = await swapAiModelsAction(fromModelId, toModelId, true);
      if (!res.ok) {
        setSwapError(res.message);
        return;
      }
      const affected = new Set([...res.plan.rewrite, ...res.plan.create].map((r) => r.methodPrefix));
      setData((d) => ({
        ...d,
        methods: d.methods.map((m) =>
          affected.has(m.methodPrefix)
            ? {
                ...m,
                effectiveModel: toModelId,
                override: {
                  modelId: toModelId,
                  setByUserId: null,
                  setByUserName: 'you',
                  updatedAt: new Date().toISOString(),
                },
              }
            : m,
        ),
      }));
      setSwapPreview({ fromModelId: res.fromModelId, toModelId: res.toModelId, plan: res.plan });
      toast.success(
        `Swapped ${affected.size} method${affected.size === 1 ? '' : 's'} from ${fromModelId} to ${toModelId}.`,
      );
    });
  }

  const swapMatchedTotal = swapPreview
    ? swapPreview.plan.rewrite.length + swapPreview.plan.create.length + swapPreview.plan.skipped.length
    : 0;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-lg border border-danger-default/30 bg-danger-default/5 p-3 text-sm text-danger-default">
          {error}
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-text-tertiary">Model catalog</div>
            <div className="mt-1 text-sm">
              {data.modelCatalog.openrouterCount} Google Gemini model
              {data.modelCatalog.openrouterCount === 1 ? '' : 's'} discovered from OpenRouter
              {' · '}
              {data.models.length} selectable in total
            </div>
            <div className="mt-0.5 text-xs text-text-tertiary">
              {data.modelCatalog.lastFetchedAt
                ? `Gemini list last refreshed ${timeAgo(data.modelCatalog.lastFetchedAt)}`
                : 'Gemini list not yet refreshed'}
              {' · auto-refreshes daily · OpenRouter is used for discovery only, not for routing AI calls'}
            </div>
          </div>
          <Button
            onClick={() => void refreshModels()}
            disabled={refreshing}
            variant="outline"
            size="sm"
          >
            <RefreshCw className={`size-icon-sm ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
            {refreshing ? 'Refreshing…' : 'Refresh from OpenRouter'}
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Active overrides" value={String(totals.overrides)} sub={`of ${data.methods.length} methods`} />
        <SummaryCard label="AI calls (30d)" value={totals.calls.toLocaleString()} sub="across all methods" />
        <SummaryCard label="AI spend (30d)" value={`$${totals.cost.toFixed(2)}`} sub="estimate" />
      </div>

      <Card>
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="size-icon-md text-accent-default" aria-hidden />
          <h2 className="text-sm font-semibold">Bulk model swap</h2>
        </div>
        <p className="mt-1 text-xs text-text-secondary">
          Replace every method currently using one model with another — including methods that
          only reach that model through the catalog default, not just methods with an explicit
          pin. Preview first; nothing changes until you press Apply.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-text-tertiary">
            From model
            <select
              className="kku-select min-w-[220px]"
              value={swapFrom}
              onChange={(e) => updateSwapFrom(e.target.value)}
              disabled={swapPending}
            >
              <option value="">— select —</option>
              {data.fromModelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.methodCount} method{m.methodCount === 1 ? '' : 's'}
                  {m.inCatalog ? '' : ' (not in catalog)'}
                </option>
              ))}
            </select>
          </label>
          <ArrowRightLeft className="mb-2 size-icon-sm text-text-tertiary" aria-hidden />
          <label className="flex flex-col gap-1 text-xs text-text-tertiary">
            To model
            <select
              className="kku-select min-w-[220px]"
              value={swapTo}
              onChange={(e) => updateSwapTo(e.target.value)}
              disabled={swapPending}
            >
              <option value="">— select —</option>
              {data.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={previewSwap}
            disabled={swapPending || !swapFrom || !swapTo || swapFrom === swapTo}
            variant="outline"
            size="sm"
          >
            Preview
          </Button>
          <Button onClick={applySwap} disabled={!canApplySwap} variant="default" size="sm">
            Apply swap
          </Button>
        </div>

        {swapFrom && swapTo && swapFrom === swapTo ? (
          <div className="mt-2 text-xs text-text-tertiary">From and to models are the same — nothing to swap.</div>
        ) : null}

        {swapError ? (
          <div className="mt-3 rounded-lg border border-danger-default/30 bg-danger-default/5 p-3 text-sm text-danger-default">
            {swapError}
          </div>
        ) : null}

        {swapPreview ? (
          <div className="mt-4 flex flex-col gap-3">
            {swapMatchedTotal === 0 ? (
              <div className="text-sm text-text-tertiary">
                No methods currently resolve to {swapPreview.fromModelId}.
              </div>
            ) : (
              <>
                <SwapPlanGroup
                  title="Will be repointed (already pinned)"
                  tone="warning"
                  rows={swapPreview.plan.rewrite}
                  toModel={swapPreview.toModelId}
                />
                <SwapPlanGroup
                  title="Will gain a new pin (currently following the catalog default)"
                  tone="info"
                  rows={swapPreview.plan.create}
                  toModel={swapPreview.toModelId}
                  note="These methods stop tracking the catalog default once pinned — future default changes won't reach them until the pin is cleared."
                />
                <SwapPlanGroup
                  title="Skipped (platform-locked, cannot be overridden)"
                  tone="neutral"
                  rows={swapPreview.plan.skipped}
                  toModel={swapPreview.toModelId}
                />
              </>
            )}
          </div>
        ) : null}
      </Card>

      {grouped.map((group) => (
        <Card key={group.module}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">{group.label}</h2>
            <span className="text-xs text-text-tertiary">{group.rows.length} method{group.rows.length === 1 ? '' : 's'}</span>
          </div>
          <div className="-mx-3 overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-text-tertiary">
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">Model in use</th>
                  <th className="px-3 py-2 text-right font-medium">30d calls</th>
                  <th className="px-3 py-2 text-right font-medium">30d cost</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => {
                  const model = data.models.find((m) => m.id === row.effectiveModel);
                  return (
                    <tr key={row.methodPrefix} className="border-t border-border-default align-top">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Badge tone={TIER_TONES[row.tier] ?? 'neutral'} >
                            {row.tier}
                          </Badge>
                          <span className="font-medium">{row.label}</span>
                        </div>
                        <div className="mt-1 text-xs text-text-tertiary">
                          <code className="rounded bg-surface-2 px-1">{row.currentVersion}</code>
                          <span className="ml-1">— {row.description}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{model?.label ?? row.effectiveModel}</span>
                          {row.lockedModel ? (
                            <Badge tone="info">
                              <Lock className="mr-1 size-icon-xs" aria-hidden />
                              Locked
                            </Badge>
                          ) : row.override ? (
                            <Badge tone="warning">Override</Badge>
                          ) : (
                            <Badge tone="neutral">Default</Badge>
                          )}
                        </div>
                        {row.lockedModel ? (
                          <div className="mt-0.5 text-[11px] text-text-tertiary">
                            Pinned by the platform — admins cannot change this model.
                            {row.lockReason ? ` ${row.lockReason}` : ''}
                          </div>
                        ) : row.override?.setByUserName ? (
                          <div className="mt-0.5 text-[11px] text-text-tertiary">
                            set by {row.override.setByUserName} · {new Date(row.override.updatedAt).toLocaleDateString()}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.thirtyDayCalls.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {row.thirtyDayCost > 0 ? `$${row.thirtyDayCost.toFixed(2)}` : <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {row.lockedModel ? (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-text-tertiary"
                              title={row.lockReason ?? 'This method is locked by the platform.'}
                            >
                              <Lock className="size-icon-sm" aria-hidden /> Locked
                            </span>
                          ) : (
                            <>
                              <Button size="sm" variant="outline" onClick={() => setEditing(row)} disabled={pending}>
                                <Cog className="size-icon-sm" aria-hidden /> Edit
                              </Button>
                              {row.override ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => clearOverride(row.methodPrefix)}
                                  disabled={pending}
                                  title={`Revert to ${row.defaultModel}`}
                                >
                                  <RotateCcw className="size-icon-sm" aria-hidden />
                                </Button>
                              ) : null}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-icon-md" aria-hidden />
              Pick model for {editing?.label}
            </DialogTitle>
            <DialogDescription>
              <span className="block">
                Default: <code className="rounded bg-surface-2 px-1">{editing?.defaultModel}</code>
              </span>
              <span className="mt-1 block text-text-tertiary">
                Changes propagate within ~60s; existing assessments stamped with the prior model are left as-is.
              </span>
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="mt-2 flex flex-col gap-2">
              {data.models.map((m) => {
                const isCurrent = editing.effectiveModel === m.id;
                const isDefault = editing.defaultModel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setOverride(editing.methodPrefix, m.id)}
                    disabled={pending}
                    className={`rounded-lg border p-3 text-left transition ${
                      isCurrent
                        ? 'border-accent-default bg-accent-default/5'
                        : 'border-border-default hover:bg-surface-2'
                    } disabled:opacity-60`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.label}</span>
                        <Badge tone="neutral" >{m.provider}</Badge>
                        {m.legacy ? <Badge tone="warning" >Legacy</Badge> : null}
                        {isDefault ? <Badge tone="info" >Default</Badge> : null}
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1 text-xs text-accent-default">
                            <Check className="size-icon-xs" aria-hidden /> in use
                          </span>
                        ) : null}
                      </div>
                      <span className="font-mono text-[11px] text-text-tertiary">
                        ${m.costInputPer1m}/${m.costOutputPer1m} per 1M
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-text-secondary">{m.description}</div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'unknown';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function SwapPlanGroup({
  title,
  tone,
  rows,
  toModel,
  note,
}: {
  title: string;
  tone: 'warning' | 'info' | 'neutral';
  rows: SwapCandidate[];
  toModel: string;
  note?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-border-default p-3">
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{rows.length}</Badge>
        <span className="text-sm font-medium">{title}</span>
      </div>
      {note ? <div className="mt-1 text-xs text-text-tertiary">{note}</div> : null}
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <li
            key={r.methodPrefix}
            className="rounded-full border border-border-default bg-surface-2 px-2 py-0.5 text-xs"
            title={
              tone === 'neutral'
                ? `Locked to ${r.lockedModel ?? r.effectiveModel} — not changed`
                : `${r.methodPrefix}: ${r.effectiveModel} → ${toModel}`
            }
          >
            {r.methodPrefix}
          </li>
        ))}
      </ul>
    </div>
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
