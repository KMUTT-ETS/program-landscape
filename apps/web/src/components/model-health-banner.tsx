import type { MethodModelHealth, ModelHealthStatus } from '@kku/shared';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@kku/ui';

// ─────────────────────────────────────────────────────────────────────────
// The ONE banner both /admin/app/ai-settings and /admin/system-status
// render. Both pages read `health` from their own GET response (each
// endpoint calls the shared `aiModelHealth()` in @kku/db) — this component
// never fetches or computes anything itself, it only renders the verdict
// it's handed. That's what keeps the two pages from disagreeing with each
// other, or with the daily notifier that reads the same function.
//
// Renders nothing when every method is 'ok' — this is a problem list, not
// a status dashboard; an empty "all good" box would just be noise on a
// page that's otherwise fine.
//
// `import type` only — @kku/shared's barrel pulls in node:crypto for
// runtime imports, which breaks the client bundle for anything importing
// it from a 'use client' file (see memory: kku_shared_barrel_client).
// Type-only imports are erased at compile time and carry nothing into
// either bundle.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<ModelHealthStatus, number> = {
  failing: 0,
  deprecated: 1,
  'off-catalog': 2,
  ok: 3,
};

// Mirrors STATUS_TONE conventions used elsewhere in the admin surfaces
// (system-status page's ingestion-run badges, ai-settings' tier badges):
// danger is reserved for the most severe case so 'failing' reads as
// meaningfully worse than a merely off-catalog or deprecated pin. 'ok'
// rows never reach this map (filtered out below) — included only so the
// lookup is total and callers never need a cast.
const STATUS_TONE: Record<ModelHealthStatus, 'danger' | 'warning' | 'success'> = {
  failing: 'danger',
  deprecated: 'warning',
  'off-catalog': 'warning',
  ok: 'success',
};

export function ModelHealthBanner({ health }: { health: MethodModelHealth[] }) {
  const problems = health
    .filter((h) => h.status !== 'ok')
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const first = problems[0];
  if (!first) return null;

  const isCritical = first.status === 'failing';

  return (
    <div
      role="alert"
      className={
        isCritical
          ? 'rounded-lg border border-danger-default/30 bg-danger-default/5 p-4'
          : 'rounded-lg border border-warning-default/30 bg-warning-default/5 p-4'
      }
    >
      <div
        className={
          isCritical
            ? 'flex items-center gap-2 text-sm font-semibold text-danger-default'
            : 'flex items-center gap-2 text-sm font-semibold text-warning-default'
        }
      >
        <AlertTriangle className="size-icon-sm flex-shrink-0" aria-hidden />
        {problems.length} AI method{problems.length === 1 ? '' : 's'} need attention
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {problems.map((p) => (
          <li key={p.methodPrefix} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span className="font-medium text-text-primary">{p.methodPrefix}</span>
            <Badge tone={STATUS_TONE[p.status]} size="sm">
              {p.status}
            </Badge>
            <span className="text-text-secondary">{p.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
