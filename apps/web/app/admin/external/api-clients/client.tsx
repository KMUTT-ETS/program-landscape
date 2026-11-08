'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useOrgNames } from '@/components/org-names-context';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  RightPanel,
  Skeleton,
} from '@kku/ui';
import { Ban, CheckCircle2, Copy, KeyRound, Plus, Power, TriangleAlert } from 'lucide-react';
// Type-only: a runtime import of either barrel from a client component pulls
// node:crypto into the browser bundle and breaks the build.
import type { ApiClientDetail, ApiClientInput, ApiClientKeyView, ApiClientSummary, IssuedApiKey } from '@kku/db';
// Deep path on purpose — this module is browser-safe; the @kku/shared barrel is not.
import {
  STAFF_PROFILE_SECTION_LABELS,
  STAFF_PROFILE_SECTIONS,
} from '@kku/shared/src/staff-profile/api-schema';

/** Shown beside the one section that carries performance data about the person. */
const TEACHING_EVALUATION_GRANT_NOTE =
  'Performance data about the person — grant only to systems with a recorded basis for it.';
const GRANTS_GRANT_NOTE = 'Funding records about the person — grant only to systems with a recorded basis for it.';
import {
  createApiClientAction,
  getApiClientDetailAction,
  issueApiKeyAction,
  revokeApiKeyAction,
  updateApiClientAction,
} from '@/lib/actions/api-clients';

// ─────────────────────────────────────────────────────────────────────────
// Staff-profile API clients — admin console.
//
// A key's plaintext exists in exactly one API response. It lives here only
// in the `reveal` state and is dropped the moment that dialog closes.
// ─────────────────────────────────────────────────────────────────────────

const ipAllowlistOffNote = (orgName: string) =>
  `IP allowlists are off on this deployment until the ${orgName} proxy address is pinned in nginx.`;

const USAGE_STATUSES = [200, 400, 403, 404, 429, 500] as const;

const DANGER_BOX =
  'rounded-lg border border-[oklch(var(--color-danger-default)/0.3)] bg-danger/5 p-3 text-sm text-danger';

interface Draft {
  name: string;
  description: string;
  ownerContact: string;
  sections: string[];
  allowCitizenIdLookup: boolean;
  allowEmailLookup: boolean;
  includeInactive: boolean;
  ipText: string;
  rateLimit: string;
}

function emptyDraft(): Draft {
  return {
    name: '',
    description: '',
    ownerContact: '',
    sections: [],
    allowCitizenIdLookup: false,
    allowEmailLookup: true,
    includeInactive: false,
    ipText: '',
    rateLimit: '60',
  };
}

function viewToDraft(c: ApiClientDetail): Draft {
  return {
    name: c.name,
    description: c.description ?? '',
    ownerContact: c.ownerContact ?? '',
    sections: [...c.allowedSections],
    allowCitizenIdLookup: c.allowCitizenIdLookup,
    allowEmailLookup: c.allowEmailLookup,
    includeInactive: c.includeInactive,
    ipText: c.ipAllowlist.join('\n'),
    rateLimit: String(c.rateLimitPerMinute),
  };
}

/** Returns a validation message, or the input the API expects. */
function draftToInput(d: Draft): { error: string } | { input: ApiClientInput } {
  const name = d.name.trim();
  if (name.length < 2 || name.length > 100) return { error: 'Name must be 2 to 100 characters.' };
  if (d.description.trim().length > 500) return { error: 'Description must be 500 characters or fewer.' };
  if (d.ownerContact.trim().length > 200) return { error: 'Contact must be 200 characters or fewer.' };
  const ipAllowlist = d.ipText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const badIp = ipAllowlist.find((s) => !IP_OR_CIDR.test(s));
  if (badIp) return { error: `"${badIp}" is not an IP address or CIDR range.` };
  if (ipAllowlist.length > 50) return { error: 'At most 50 IP ranges.' };
  const rate = Number(d.rateLimit);
  if (!Number.isInteger(rate) || rate < 1 || rate > 600) {
    return { error: 'Rate limit must be a whole number from 1 to 600.' };
  }
  return {
    input: {
      name,
      description: d.description.trim() || null,
      ownerContact: d.ownerContact.trim() || null,
      allowedSections: STAFF_PROFILE_SECTIONS.filter((s) => d.sections.includes(s)),
      allowCitizenIdLookup: d.allowCitizenIdLookup,
      allowEmailLookup: d.allowEmailLookup,
      includeInactive: d.includeInactive,
      ipAllowlist,
      rateLimitPerMinute: rate,
    },
  };
}

// A shape check only — the API validates each entry properly with
// isValidAllowlistEntry, which cannot be imported here (it uses node:net).
const IP_OR_CIDR = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function exact(iso: string | null): string | undefined {
  return iso ? new Date(iso).toLocaleString() : undefined;
}

function lookupsLabel(c: { allowCitizenIdLookup: boolean; allowEmailLookup: boolean }): string {
  const parts = [c.allowCitizenIdLookup ? 'citizen id' : null, c.allowEmailLookup ? 'email' : null].filter(
    (x): x is string => x !== null,
  );
  return parts.length ? parts.join(', ') : 'none';
}

function keyState(k: ApiClientKeyView): 'active' | 'expired' | 'revoked' {
  if (k.revokedAt) return 'revoked';
  if (k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
}

function statusTone(status: number): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status >= 500) return 'danger';
  if (status >= 400) return 'warning';
  if (status >= 200 && status < 300) return 'success';
  return 'neutral';
}

type RevealState = { clientName: string; key: IssuedApiKey };

export function ApiClientsClient({
  initial,
  loadError,
  ipAllowlistEnabled,
}: {
  initial: ApiClientSummary[];
  loadError: string | null;
  ipAllowlistEnabled: boolean;
}) {
  const org = useOrgNames();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [createDraft, setCreateDraft] = useState<Draft | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const clients = initial;
  const totals = useMemo(
    () =>
      clients.reduce(
        (acc, c) => ({
          active: acc.active + (c.status === 'ACTIVE' ? 1 : 0),
          keys: acc.keys + c.activeKeys,
          requests30d: acc.requests30d + c.requests30d,
        }),
        { active: 0, keys: 0, requests30d: 0 },
      ),
    [clients],
  );

  function submitCreate() {
    if (!createDraft) return;
    const parsed = draftToInput(createDraft);
    if ('error' in parsed) {
      setCreateError(parsed.error);
      return;
    }
    setCreateError(null);
    startTransition(async () => {
      const res = await createApiClientAction(parsed.input);
      if (!res.ok) {
        setCreateError(res.message);
        return;
      }
      setCreateDraft(null);
      setReveal({ clientName: res.data.client.name, key: res.data.key });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {loadError ? <div className={DANGER_BOX}>Could not load API clients: {loadError}</div> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Clients" value={String(clients.length)} sub={`${totals.active} active`} />
        <SummaryCard label="Active keys" value={String(totals.keys)} sub="across all clients" />
        <SummaryCard label="Requests (30d)" value={totals.requests30d.toLocaleString()} sub="all clients" />
      </div>

      <Card padding="sm">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Clients</h2>
          <Button
            size="sm"
            onClick={() => {
              setCreateError(null);
              setCreateDraft(emptyDraft());
            }}
            disabled={pending}
          >
            <Plus className="size-icon-sm" aria-hidden /> New client
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="text-left text-xs text-text-tertiary">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Sections</th>
                <th className="px-3 py-2 font-medium">Lookups</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 text-right font-medium">Requests 24h</th>
                <th className="px-3 py-2 text-right font-medium">Requests 30d</th>
                <th className="px-3 py-2 text-right font-medium">Not found (30d)</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const rate = c.requests30d > 0 ? c.notFound30d / c.requests30d : null;
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer border-t border-default align-top hover:bg-surface-2/60 focus-visible:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-default"
                    role="button"
                    aria-label={`Open ${c.name}`}
                    tabIndex={0}
                    onClick={() => setSelectedId(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(c.id);
                      }
                    }}
                  >
                    <td className="px-3 py-3">
                      <div className="font-medium">{c.name}</div>
                      {c.ownerContact ? (
                        <div className="mt-0.5 text-xs text-text-tertiary">{c.ownerContact}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {c.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs text-text-secondary">
                      {c.allowedSections.length ? c.allowedSections.join(', ') : 'person only'}
                    </td>
                    <td className="px-3 py-3 text-xs text-text-secondary">{lookupsLabel(c)}</td>
                    <td className="px-3 py-3 text-xs text-text-tertiary" title={exact(c.lastUsedAt)}>
                      {relativeTime(c.lastUsedAt)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.requests24h.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.requests30d.toLocaleString()}</td>
                    <td
                      className={`px-3 py-3 text-right tabular-nums ${
                        rate !== null && rate > 0.2 ? 'text-warning' : ''
                      }`}
                      title={rate === null ? undefined : `${c.notFound30d} of ${c.requests30d} requests`}
                    >
                      {rate === null ? '—' : `${(rate * 100).toFixed(1)} %`}
                    </td>
                  </tr>
                );
              })}
              {clients.length === 0 && !loadError ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-text-tertiary">
                    No clients yet. Create one with <strong>New client</strong>, then hand its key to the calling
                    system.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-text-tertiary">
        A not-found rate above 20 % usually means the caller is sending identifiers for people who are not {org.en} staff
        records, or is guessing.
      </p>

      <Dialog
        open={createDraft != null}
        onOpenChange={(o) => {
          if (!o) setCreateDraft(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          {createDraft ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <KeyRound className="size-icon-md" aria-hidden /> New API client
                </DialogTitle>
                <DialogDescription>
                  Creating a client issues its first key. The key is shown once, on the next screen.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-2">
                <ClientFields draft={createDraft} onChange={setCreateDraft} ipAllowlistEnabled={ipAllowlistEnabled} />
              </div>
              {createError ? <div className={`mt-3 ${DANGER_BOX}`}>{createError}</div> : null}
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => setCreateDraft(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button onClick={submitCreate} disabled={pending}>
                  {pending ? 'Creating…' : 'Create client'}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <KeyRevealDialog reveal={reveal} onClose={() => setReveal(null)} />

      <ClientDetailPanel
        clientId={selectedId}
        onClose={() => setSelectedId(null)}
        ipAllowlistEnabled={ipAllowlistEnabled}
        onKeyIssued={(r) => setReveal(r)}
      />
    </div>
  );
}

// ─── Key reveal ────────────────────────────────────────────────────────────

function KeyRevealDialog({ reveal, onClose }: { reveal: RevealState | null; onClose: () => void }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    setCopied('idle');
  }, [reveal]);

  async function copy() {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.key.key);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <Dialog
      open={reveal != null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {/* Only Done closes it: Escape or a stray click outside would destroy the
          one copy of the key. */}
      <DialogContent
        className="max-w-xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {reveal ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-icon-md" aria-hidden /> Key for {reveal.clientName}
              </DialogTitle>
              <DialogDescription>
                {reveal.key.expiresAt
                  ? `Expires ${new Date(reveal.key.expiresAt).toLocaleString()}.`
                  : 'This key does not expire. Revoke it when the calling system is retired.'}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-3 flex items-center gap-2">
              <input
                readOnly
                value={reveal.key.key}
                aria-label="API key"
                onFocus={(e) => e.currentTarget.select()}
                className="h-[2.25rem] w-full rounded-md border border-default bg-surface-2 px-3 font-mono text-xs text-text-primary"
              />
              <Button variant="outline" size="sm" onClick={copy}>
                <Copy className="size-icon-sm" aria-hidden /> Copy
              </Button>
            </div>
            <div className="mt-2 min-h-[1.25rem] text-xs" aria-live="polite">
              {copied === 'copied' ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="size-icon-xs" aria-hidden /> Copied to clipboard.
                </span>
              ) : copied === 'failed' ? (
                <span className="text-danger">Clipboard is blocked here; select the key and copy it by hand.</span>
              ) : null}
            </div>
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-[oklch(var(--color-warning-default)/0.35)] bg-warning/5 p-3 text-sm">
              <TriangleAlert className="mt-[2px] size-icon-sm shrink-0 text-warning" aria-hidden />
              <span>Copy this key now. It will not be shown again.</span>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ─── Detail panel ──────────────────────────────────────────────────────────

function ClientDetailPanel({
  clientId,
  onClose,
  ipAllowlistEnabled,
  onKeyIssued,
}: {
  clientId: string | null;
  onClose: () => void;
  ipAllowlistEnabled: boolean;
  onKeyIssued: (r: RevealState) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [detail, setDetail] = useState<ApiClientDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expiry, setExpiry] = useState('');
  const [revoking, setRevoking] = useState<{ keyId: string; reason: string } | null>(null);

  // The client the panel is showing NOW. Every async result checks it before
  // touching state, so a slow response for client A can never land in (and
  // reset the settings form of) client B's panel.
  const currentIdRef = useRef<string | null>(clientId);
  currentIdRef.current = clientId;
  const isCurrent = (id: string) => currentIdRef.current === id;

  const load = useCallback(async (id: string) => {
    const res = await getApiClientDetailAction(id);
    if (currentIdRef.current !== id) return;
    if (!res.ok) {
      setLoadError(res.message);
      return;
    }
    setLoadError(null);
    setDetail(res.data);
    setDraft(viewToDraft(res.data));
  }, []);

  useEffect(() => {
    setDetail(null);
    setDraft(null);
    setLoadError(null);
    setError(null);
    setNotice(null);
    setExpiry('');
    setRevoking(null);
    if (clientId) void load(clientId);
  }, [clientId, load]);

  function mutate(
    id: string,
    fn: () => Promise<{ ok: true } | { ok: false; message: string }>,
    success: string,
  ) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      router.refresh();
      if (!isCurrent(id)) return;
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setNotice(success);
      await load(id);
    });
  }

  function saveSettings() {
    if (!clientId || !draft) return;
    const parsed = draftToInput(draft);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    // With allowlists off the field is read-only; leave the stored value alone.
    const { ipAllowlist, ...rest } = parsed.input;
    const patch = ipAllowlistEnabled ? { ...rest, ipAllowlist } : rest;
    const id = clientId;
    mutate(id, () => updateApiClientAction(id, patch), 'Settings saved.');
  }

  function toggleStatus() {
    if (!clientId || !detail) return;
    const status = detail.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    const id = clientId;
    mutate(
      id,
      () => updateApiClientAction(id, { status }),
      status === 'DISABLED' ? 'Client disabled. Its keys stop working immediately.' : 'Client enabled.',
    );
  }

  function issueKey() {
    if (!clientId || !detail) return;
    let expiresAt: string | null = null;
    if (expiry) {
      const d = new Date(`${expiry}T23:59:59`);
      if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        setError('Expiry must be a future date.');
        return;
      }
      expiresAt = d.toISOString();
    }
    const clientName = detail.name;
    const id = clientId;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await issueApiKeyAction(id, expiresAt);
      // The key is revealed even if the admin has moved to another client
      // meanwhile — it is the only copy, and the dialog names its client.
      if (res.ok) onKeyIssued({ clientName, key: res.data });
      router.refresh();
      if (!isCurrent(id)) return;
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setExpiry('');
      await load(id);
    });
  }

  function confirmRevoke() {
    if (!clientId || !revoking) return;
    const reason = revoking.reason.trim();
    if (reason.length < 3) {
      setError('Give a reason of at least 3 characters.');
      return;
    }
    const { keyId } = revoking;
    setRevoking(null);
    const id = clientId;
    mutate(id, () => revokeApiKeyAction(id, keyId, reason), 'Key revoked.');
  }

  // Recomputed on every render (cheap), so a panel left open past midnight
  // still offers the right earliest date.
  const tomorrowDate = new Date(Date.now() + 86_400_000);
  const tomorrow = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(
    tomorrowDate.getDate(),
  ).padStart(2, '0')}`;

  const usage = useMemo(() => {
    const counts = new Map((detail?.statusCounts30d ?? []).map((r) => [r.status, r.count]));
    const listed = new Set<number>(USAGE_STATUSES);
    const other = (detail?.statusCounts30d ?? [])
      .filter((r) => !listed.has(r.status))
      .reduce((s, r) => s + r.count, 0);
    return { counts, other };
  }, [detail]);

  return (
    <RightPanel
      open={clientId != null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={detail?.name ?? 'API client'}
      widthClass="w-[min(720px,94vw)]"
    >
      {loadError ? (
        <div className={DANGER_BOX}>Could not load this client: {loadError}</div>
      ) : !detail || !draft ? (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-[2rem] w-[40%]" />
          <Skeleton className="h-[12rem] w-full" />
          <Skeleton className="h-[8rem] w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-6 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge tone={detail.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {detail.status === 'ACTIVE' ? 'Active' : 'Disabled'}
              </Badge>
              <span className="text-xs text-text-tertiary" title={exact(detail.lastUsedAt)}>
                Last used: {relativeTime(detail.lastUsedAt)}
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={toggleStatus} disabled={pending}>
              {detail.status === 'ACTIVE' ? (
                <>
                  <Ban className="size-icon-sm" aria-hidden /> Disable client
                </>
              ) : (
                <>
                  <Power className="size-icon-sm" aria-hidden /> Enable client
                </>
              )}
            </Button>
          </div>

          {error ? <div className={DANGER_BOX}>{error}</div> : null}
          {notice ? (
            <div
              className="rounded-lg border border-[oklch(var(--color-success-default)/0.3)] bg-success/5 p-3 text-sm"
              aria-live="polite"
            >
              {notice}
            </div>
          ) : null}

          <PanelSection title="Keys">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="text-left text-text-tertiary">
                    <th className="px-2 py-2 font-medium">Key</th>
                    <th className="px-2 py-2 font-medium">Created</th>
                    <th className="px-2 py-2 font-medium">Expires</th>
                    <th className="px-2 py-2 font-medium">Last used</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {detail.keys.map((k) => {
                    const state = keyState(k);
                    const isRevoking = revoking?.keyId === k.id;
                    return (
                      <tr key={k.id} className="border-t border-default align-top">
                        <td className="px-2 py-2 font-mono">{k.prefix}…</td>
                        <td className="px-2 py-2 text-text-secondary">{new Date(k.createdAt).toLocaleDateString()}</td>
                        <td className="px-2 py-2 text-text-secondary">
                          {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="px-2 py-2 text-text-secondary" title={exact(k.lastUsedAt)}>
                          {relativeTime(k.lastUsedAt)}
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            size="sm"
                            tone={state === 'active' ? 'success' : state === 'revoked' ? 'danger' : 'neutral'}
                          >
                            {state}
                          </Badge>
                          {state === 'revoked' && k.revokedReason ? (
                            <div className="mt-1 max-w-[180px] text-text-tertiary" title={exact(k.revokedAt)}>
                              {k.revokedReason}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {state === 'active' && !isRevoking ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-danger hover:text-danger"
                              onClick={() => {
                                setError(null);
                                setRevoking({ keyId: k.id, reason: '' });
                              }}
                              disabled={pending}
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {detail.keys.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-text-tertiary">
                        No keys. Issue one below.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {revoking ? (
              <div className="mt-3 flex flex-col gap-2 rounded-lg border border-default bg-surface-1 p-3">
                <label className="text-xs text-text-tertiary" htmlFor="revoke-reason">
                  Why is this key being revoked? The reason is kept on the key and in the audit log.
                </label>
                <Input
                  id="revoke-reason"
                  autoFocus
                  value={revoking.reason}
                  onChange={(e) => setRevoking({ ...revoking, reason: e.target.value })}
                  placeholder="e.g. key leaked in a support ticket"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setRevoking(null)} disabled={pending}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={confirmRevoke}
                    variant="danger"
                    disabled={pending || revoking.reason.trim().length < 3}
                  >
                    Revoke key
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-tertiary">Expires on (optional)</span>
                <Input
                  type="date"
                  min={tomorrow}
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="w-[11rem]"
                  aria-describedby="key-expiry-hint"
                />
                <span id="key-expiry-hint" className="text-[11px] text-text-tertiary">
                  Expires at 23:59:59 local time on the chosen day
                </span>
              </label>
              <Button size="sm" onClick={issueKey} disabled={pending || detail.status !== 'ACTIVE'}>
                <KeyRound className="size-icon-sm" aria-hidden /> Issue key
              </Button>
              {detail.status !== 'ACTIVE' ? (
                <span className="text-xs text-text-tertiary">Enable the client to issue keys.</span>
              ) : null}
            </div>
          </PanelSection>

          <PanelSection title="Usage (30 days)">
            <dl className="grid grid-cols-3 gap-2 sm:grid-cols-7">
              {USAGE_STATUSES.map((s) => (
                <div key={s} className="rounded-md border border-subtle bg-surface-1 px-2 py-2">
                  <dt className="text-xs text-text-tertiary">HTTP {s}</dt>
                  <dd className="mt-0.5 text-base font-medium tabular-nums">
                    {(usage.counts.get(s) ?? 0).toLocaleString()}
                  </dd>
                </div>
              ))}
              <div className="rounded-md border border-subtle bg-surface-1 px-2 py-2">
                <dt className="text-xs text-text-tertiary">Other</dt>
                <dd className="mt-0.5 text-base font-medium tabular-nums">{usage.other.toLocaleString()}</dd>
              </div>
            </dl>
          </PanelSection>

          <PanelSection title="Recent calls">
            {detail.recentRequests.length === 0 ? (
              <p className="text-xs text-text-tertiary">No calls yet.</p>
            ) : (
              <div className="max-h-[22rem] overflow-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="sticky top-0 bg-surface-1">
                    <tr className="text-left text-text-tertiary">
                      <th className="px-2 py-2 font-medium">Time</th>
                      <th className="px-2 py-2 font-medium">Lookup</th>
                      <th className="px-2 py-2 font-medium">Staff</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 text-right font-medium">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.recentRequests.map((r) => (
                      <tr key={r.id} className="border-t border-subtle">
                        <td className="px-2 py-1.5 text-text-secondary">{new Date(r.createdAt).toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-text-secondary">
                          {r.lookupType === 'CITIZEN_ID' ? 'citizen id' : r.lookupType === 'EMAIL' ? 'email' : '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          {r.staffName ?? <span className="text-text-tertiary">no match</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge size="sm" tone={statusTone(r.status)}>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.latencyMs.toLocaleString()} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PanelSection>

          <PanelSection title="Settings">
            <ClientFields draft={draft} onChange={setDraft} ipAllowlistEnabled={ipAllowlistEnabled} />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft(viewToDraft(detail))} disabled={pending}>
                Reset
              </Button>
              <Button size="sm" onClick={saveSettings} disabled={pending}>
                {pending ? 'Saving…' : 'Save settings'}
              </Button>
            </div>
          </PanelSection>

          <PanelSection title="How to call">
            <pre className="overflow-x-auto rounded-md border border-subtle bg-surface-2 p-3 font-mono text-xs leading-relaxed">
              {`curl -sS --max-time 60 https://<your-host>/api/v1/external/staff-profile \\
  -H "Authorization: Bearer <your key>" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"someone@example.ac.th"}'`}
            </pre>
            <p className="mt-2 text-xs text-text-tertiary">
              Full contract, error codes and field list:{' '}
              <code className="rounded-sm bg-surface-2 px-1">docs/integrations/staff-profile-api.md</code>
            </p>
          </PanelSection>
        </div>
      )}
    </RightPanel>
  );
}

// ─── Shared form ───────────────────────────────────────────────────────────

function ClientFields({
  draft,
  onChange,
  ipAllowlistEnabled,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  ipAllowlistEnabled: boolean;
}) {
  const org = useOrgNames();
  const toggleSection = (s: string) =>
    onChange({
      ...draft,
      sections: draft.sections.includes(s) ? draft.sections.filter((x) => x !== s) : [...draft.sections, s],
    });

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" hint="unique">
          <Input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Contact" hint="who to call about this system">
          <Input
            value={draft.ownerContact}
            onChange={(e) => onChange({ ...draft, ownerContact: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Description (optional)">
        <textarea
          rows={2}
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          className={TEXTAREA}
        />
      </Field>

      <fieldset>
        <legend className="text-xs text-text-tertiary">Sections returned (person details are always included)</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {STAFF_PROFILE_SECTIONS.filter((s) => s !== 'teachingEvaluation' && s !== 'grants').map((s) => (
            <Check
              key={s}
              label={STAFF_PROFILE_SECTION_LABELS[s]}
              wireKey={s}
              checked={draft.sections.includes(s)}
              onChange={() => toggleSection(s)}
            />
          ))}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
          <Check
            label={STAFF_PROFILE_SECTION_LABELS.teachingEvaluation}
            wireKey="teachingEvaluation"
            checked={draft.sections.includes('teachingEvaluation')}
            onChange={() => toggleSection('teachingEvaluation')}
          />
          <span className="text-xs text-warning">{TEACHING_EVALUATION_GRANT_NOTE}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4">
          <Check
            label={STAFF_PROFILE_SECTION_LABELS.grants}
            wireKey="grants"
            checked={draft.sections.includes('grants')}
            onChange={() => toggleSection('grants')}
          />
          <span className="text-xs text-warning">{GRANTS_GRANT_NOTE}</span>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-xs text-text-tertiary">Lookups this client may use</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          <Check
            label="citizen id"
            checked={draft.allowCitizenIdLookup}
            onChange={() => onChange({ ...draft, allowCitizenIdLookup: !draft.allowCitizenIdLookup })}
          />
          <Check
            label="email"
            checked={draft.allowEmailLookup}
            onChange={() => onChange({ ...draft, allowEmailLookup: !draft.allowEmailLookup })}
          />
          <Check
            label="include staff who have left"
            checked={draft.includeInactive}
            onChange={() => onChange({ ...draft, includeInactive: !draft.includeInactive })}
          />
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem]">
        <Field label="Allowed IP ranges" hint="one per line, IP or CIDR">
          <textarea
            rows={3}
            value={draft.ipText}
            onChange={(e) => onChange({ ...draft, ipText: e.target.value })}
            disabled={!ipAllowlistEnabled}
            placeholder={ipAllowlistEnabled ? '10.101.0.0/16' : ''}
            className={`${TEXTAREA} font-mono text-xs`}
          />
          {!ipAllowlistEnabled ? <p className="mt-1 text-xs text-text-tertiary">{ipAllowlistOffNote(org.en)}</p> : null}
        </Field>
        <Field label="Rate limit" hint="requests per minute, 1–600">
          <Input
            type="number"
            min={1}
            max={600}
            step={1}
            value={draft.rateLimit}
            onChange={(e) => onChange({ ...draft, rateLimit: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

const TEXTAREA =
  'w-full rounded-md border border-default bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50';

function Check({
  label,
  wireKey,
  checked,
  onChange,
}: {
  label: string;
  /** The API's own name for the option, shown so admins can match it to the docs. */
  wireKey?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 py-1">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-icon-sm accent-accent-default" />
      <span>{label}</span>
      {wireKey ? <code className="font-mono text-[11px] text-text-tertiary">{wireKey}</code> : null}
    </label>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-text-tertiary">{label}</span>
        {hint ? <span className="text-[11px] text-text-tertiary/80">{hint}</span> : null}
      </div>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-subtle pt-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="mt-1 text-2xl font-medium tabular-nums">{value}</div>
      <div className="text-xs text-text-tertiary">{sub}</div>
    </Card>
  );
}
