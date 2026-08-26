'use client';

import * as React from 'react';
import { Card, Button, Badge } from '@kku/ui';
import { Globe, Copy, Check, RefreshCw, Share2, Eye, EyeOff } from 'lucide-react';
import type { PublicProfileState } from '@kku/shared';

// Share card on /profile — toggles public sharing on/off, shows the
// public URL + QR code, and lets the owner regenerate the slug.
//
// State lives in this client component; the server endpoints
// (PATCH /api/v1/me/public-profile, POST .../regenerate-slug) are
// proxied through the Next API at /api/me/public-profile so the
// component stays single-origin (avoids leaking JWT cookies to the
// NestJS API host).

interface Props {
  initial: PublicProfileState;
  qrSvg: string | null; // null when initially disabled (no slug yet)
  publicUrl: string | null; // absolute URL — null when disabled
  origin: string; // app origin, used to recompute publicUrl after regenerate
}

export function ShareCard({ initial, qrSvg, publicUrl, origin }: Props) {
  const [state, setState] = React.useState<PublicProfileState>(initial);
  const [qr, setQr] = React.useState<string | null>(qrSvg);
  const [busy, setBusy] = React.useState<'enable' | 'index' | 'regen' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [confirmEnable, setConfirmEnable] = React.useState(false);

  const url = state.slug ? `${origin}/p/${state.slug}` : null;

  React.useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  async function patch(body: { enabled?: boolean; indexable?: boolean }, kind: 'enable' | 'index') {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch('/api/me/public-profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as PublicProfileState;
      setState(next);
      // Refresh QR if slug appeared / changed
      if (next.slug && next.slug !== state.slug) {
        const qrRes = await fetch(`/api/me/public-profile/qr?slug=${next.slug}`);
        if (qrRes.ok) setQr(await qrRes.text());
      } else if (!next.enabled) {
        // Keep QR cached; harmless when card is collapsed.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    if (!confirm('Regenerate link? The current QR code and link will stop working immediately.')) return;
    setBusy('regen');
    setError(null);
    try {
      const res = await fetch('/api/me/public-profile/regenerate-slug', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as PublicProfileState;
      setState(next);
      if (next.slug) {
        const qrRes = await fetch(`/api/me/public-profile/qr?slug=${next.slug}`);
        if (qrRes.ok) setQr(await qrRes.text());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regenerate failed');
    } finally {
      setBusy(null);
    }
  }

  async function copyUrl() {
    if (!url) return;
    // navigator.clipboard.writeText is gated to "secure contexts" —
    // localhost OR https. The KKU dev box is reached over plain HTTP
    // at 10.101.x.x, so the modern API is unavailable. Try it first,
    // then fall back to the legacy textarea+execCommand path which
    // works on http origins.
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        return;
      } catch {
        // fall through
      }
    }
    // Legacy fallback. Create an offscreen textarea, select, exec.
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, url.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        setCopied(true);
      } else {
        setError('Copy failed — please select the URL manually.');
      }
    } catch {
      setError('Copy failed — please select the URL manually.');
    }
  }

  // Pre-toggle confirmation panel — first-time enable shows what
  // becomes public so the user has informed consent (PDPA posture).
  if (confirmEnable && !state.enabled) {
    return (
      <Card className="mb-6 p-6" elevation="lg">
        <div className="flex items-start gap-3">
          <Eye className="mt-0.5 size-icon-lg text-accent-default" />
          <div className="flex-1 space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">
              Make this profile public?
            </h2>
            <p className="text-sm text-text-secondary">
              Anyone with the link can see the page. The following will be visible:
            </p>
            <ul className="ml-1 list-inside list-disc space-y-1 text-sm text-text-secondary">
              <li>Your name, rank, and faculty / department</li>
              <li>Your profile photo</li>
              <li>Your education history</li>
              <li>Your publication list with citation counts</li>
              <li>Your AI expertise summary, if generated</li>
              <li>Programs you teach in</li>
            </ul>
            <p className="text-sm text-text-secondary">
              <strong>Hidden:</strong> your email address, employee ID, and any
              data not already public.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                size="sm"
                onClick={() => {
                  setConfirmEnable(false);
                  void patch({ enabled: true }, 'enable');
                }}
                disabled={busy !== null}
              >
                {busy === 'enable' ? 'Enabling…' : 'Enable public profile'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmEnable(false)}
              >
                Cancel
              </Button>
            </div>
            {error && <p className="text-xs text-danger-default">{error}</p>}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6 p-6" elevation="lg">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Share2 className="size-icon-lg text-accent-default" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              Public profile
            </h2>
            <p className="text-xs text-text-tertiary">
              Share a public version of this page with a link or QR code.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {state.enabled ? (
            <Badge tone="success">
              <Globe className="mr-1 size-icon-xs" />
              Public
            </Badge>
          ) : (
            <Badge tone="neutral">Private</Badge>
          )}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {!state.enabled && (
          <Button
            size="sm"
            onClick={() => setConfirmEnable(true)}
            disabled={busy !== null}
          >
            Enable public profile
          </Button>
        )}

        {state.enabled && url && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
              {/* Link + actions */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={url}
                    className="flex-1 truncate rounded-md border border-border-subtle bg-surface-2 px-3 py-2 font-mono text-xs text-text-primary"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={copyUrl}
                    aria-label="Copy link"
                  >
                    {copied ? (
                      <>
                        <Check className="mr-1 size-icon-sm" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1 size-icon-sm" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>

                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={state.indexable}
                    onChange={(e) =>
                      void patch({ indexable: e.currentTarget.checked }, 'index')
                    }
                    disabled={busy !== null}
                    className="mt-0.5"
                  />
                  <span className="text-text-secondary">
                    Allow search engines (Google, Bing) to index this page
                  </span>
                </label>
                {!state.indexable && (
                  <p className="text-xs text-text-tertiary">
                    <EyeOff className="mr-1 inline size-icon-xs" />
                    Hidden from search engines — link sharing still works.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={regenerate}
                    disabled={busy !== null}
                  >
                    <RefreshCw className="mr-1 size-icon-sm" />
                    {busy === 'regen' ? 'Regenerating…' : 'Regenerate link'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void patch({ enabled: false }, 'enable')}
                    disabled={busy !== null}
                  >
                    Make private
                  </Button>
                </div>
              </div>

              {/* QR */}
              {qr && (
                <div className="flex flex-col items-center gap-2 rounded-md border border-border-subtle bg-surface-1 p-3">
                  <div
                    className="size-32 [&_svg]:h-full [&_svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: qr }}
                  />
                  <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
                    Scan to open
                  </span>
                </div>
              )}
            </div>

            {state.updatedAt && (
              <p className="text-xs text-text-tertiary">
                Last changed {new Date(state.updatedAt).toLocaleString()}
              </p>
            )}
          </>
        )}

        {error && <p className="text-xs text-danger-default">{error}</p>}
      </div>
    </Card>
  );
}
