'use client';

import { useMemo, useState, useTransition } from 'react';
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
import { Check, Cog, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import {
  clearAiModelOverrideAction,
  refreshAiModelsAction,
  setAiModelOverrideAction,
} from '@/lib/actions/ai-settings';

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

export interface AiSettingsResponse {
  methods: AiSettingsMethodRow[];
  models: AiSettingsModel[];
  modelCatalog: {
    lastFetchedAt: string | null;
    openrouterCount: number;
    staticCount: number;
  };
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
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
            {refreshing ? 'Refreshing…' : 'Refresh from OpenRouter'}
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Active overrides" value={String(totals.overrides)} sub={`of ${data.methods.length} methods`} />
        <SummaryCard label="AI calls (30d)" value={totals.calls.toLocaleString()} sub="across all methods" />
        <SummaryCard label="AI spend (30d)" value={`$${totals.cost.toFixed(2)}`} sub="estimate" />
      </div>

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
                          {row.override ? <Badge tone="warning" >Override</Badge> : <Badge tone="neutral" >Default</Badge>}
                        </div>
                        {row.override?.setByUserName ? (
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
                          <Button size="sm" variant="outline" onClick={() => setEditing(row)} disabled={pending}>
                            <Cog className="h-3.5 w-3.5" aria-hidden /> Edit
                          </Button>
                          {row.override ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => clearOverride(row.methodPrefix)}
                              disabled={pending}
                              title={`Revert to ${row.defaultModel}`}
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          ) : null}
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
              <Sparkles className="h-4 w-4" aria-hidden />
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
                            <Check className="h-3 w-3" aria-hidden /> in use
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

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="mt-1 text-2xl font-medium tabular-nums">{value}</div>
      <div className="text-xs text-text-tertiary">{sub}</div>
    </Card>
  );
}
