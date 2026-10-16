'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Badge } from '@kku/ui';
import { deriveBrandTokens, type BrandCheck } from '@kku/shared/brand';
import { ProductMark } from '@/components/brand/product-mark-component';
import { readSaveResponse } from './save-response';
import type { OrganizationProfileDto } from './client';

type AssetKind = 'logo-light' | 'logo-dark' | 'favicon';
type Scope = React.CSSProperties & Record<string, string>;

const ASSETS: { kind: AssetKind; label: string; accept: string; key: keyof OrganizationProfileDto }[] = [
  { kind: 'logo-light', label: 'Logo (light mode)', accept: 'image/png,image/svg+xml', key: 'logoLightKey' },
  { kind: 'logo-dark', label: 'Logo (dark mode)', accept: 'image/png,image/svg+xml', key: 'logoDarkKey' },
  { kind: 'favicon', label: 'Favicon', accept: 'image/png', key: 'faviconKey' },
];

function scopeStyle(tokens: Partial<Record<string, string>>): Scope {
  const style: Scope = {};
  for (const [name, value] of Object.entries(tokens)) {
    if (value) style[`--color-${name}`] = value;
  }
  return style;
}

function CheckLine({ c }: { c: BrandCheck }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <Badge tone={c.pass ? 'success' : 'warning'}>{c.pass ? 'pass' : 'fail'}</Badge>
      <span>
        {c.name} ({c.mode}): {c.ratio.toFixed(2)}:1 — needs {c.required}:1
      </span>
    </li>
  );
}

function ColourField({
  label, value, onChange, onClear,
}: { label: string; value: string; onChange: (v: string) => void; onClear?: () => void }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-text-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          // eslint-disable-next-line no-restricted-syntax -- neutral placeholder for the native picker, not UI styling
          value={valid ? value : '#808080'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded-md border border-default bg-surface-1"
        />
        <input
          aria-label={`${label} hex`}
          value={value}
          placeholder="#rrggbb"
          onChange={(e) => onChange(e.target.value.trim())}
          className="w-32 rounded-md border border-default bg-surface-1 px-2 py-1 font-mono"
        />
        {onClear && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

function Preview({ style }: { style: Scope }) {
  return (
    <div style={style} className="flex items-center gap-3">
      <Button type="button" variant="primary">Sample button</Button>
      <Badge tone="info">Sample</Badge>
      <ProductMark size={28} />
    </div>
  );
}

export function BrandTab({
  profile,
  onSaved,
}: {
  profile: OrganizationProfileDto;
  onSaved: (p: OrganizationProfileDto) => void;
}) {
  const [primary, setPrimary] = useState(profile.primaryColor ?? '');
  const [secondary, setSecondary] = useState(profile.secondaryColor ?? '');
  const [version, setVersion] = useState(profile.version);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<AssetKind | null>(null);

  const derived = deriveBrandTokens(primary || null, secondary || null);

  function accept(next: OrganizationProfileDto) {
    setVersion(next.version);
    onSaved(next);
  }

  async function saveColours() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin-organization/brand', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ primaryColor: primary || null, secondaryColor: secondary || null, expectedVersion: version }),
      });
      const out = await readSaveResponse(res);
      if (res.status === 409 && out.errorCode === 'ORG_VERSION_CONFLICT') {
        toast.error('Someone else changed the organisation — reload the page and try again.');
        return;
      }
      if (out.errorMessage !== null) throw new Error(out.errorMessage);
      accept((out.body as { profile: OrganizationProfileDto }).profile);
      toast.success('Brand saved.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function upload(kind: AssetKind, file: File) {
    setUploading(kind);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/admin-organization/assets/${kind}`, { method: 'POST', body: form });
      const out = await readSaveResponse(res);
      if (out.errorMessage !== null) throw new Error(out.errorMessage);
      accept((out.body as { profile: OrganizationProfileDto }).profile);
      toast.success('Image uploaded.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  async function remove(kind: AssetKind) {
    setUploading(kind);
    try {
      const res = await fetch(`/api/admin-organization/assets/${kind}`, { method: 'DELETE' });
      const out = await readSaveResponse(res);
      if (out.errorMessage !== null) throw new Error(out.errorMessage);
      accept((out.body as { profile: OrganizationProfileDto }).profile);
      toast.success('Image removed.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Colours</h2>
        <ColourField label="Primary colour" value={primary} onChange={setPrimary} />
        <ColourField label="Secondary colour" value={secondary} onChange={setSecondary} onClear={() => setSecondary('')} />

        <ul className="flex flex-col gap-1">
          {derived.checks.map((c) => (
            <CheckLine key={`${c.name}-${c.mode}`} c={c} />
          ))}
        </ul>
        {derived.errors.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-danger">
            {derived.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div>
          <Button type="button" disabled={!derived.ok || saving} onClick={() => void saveColours()}>
            Save colours
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-sm text-text-secondary">Preview</span>
          <div className="rounded-md border border-default bg-surface-0 p-3">
            <Preview style={scopeStyle(derived.tokens.light)} />
          </div>
          <div data-theme="dark" className="rounded-md bg-surface-0 p-3">
            <Preview style={scopeStyle(derived.tokens.dark)} />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Logos and favicon</h2>
        {ASSETS.map((a) => {
          const stored = profile[a.key] as string | null;
          const has = stored !== null && stored !== undefined;
          return (
            <div key={a.kind} className="flex items-center gap-3 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/brand/${a.kind}?v=${version}`}
                alt=""
                className="size-12 rounded-md border border-default bg-surface-1 object-contain p-1"
              />
              <div className="flex flex-col gap-1">
                <span className="text-text-secondary">{a.label}</span>
                <input
                  type="file"
                  accept={a.accept}
                  disabled={uploading !== null}
                  aria-label={`Upload ${a.label}`}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void upload(a.kind, f);
                  }}
                />
              </div>
              {has && (
                <Button type="button" variant="ghost" size="sm" disabled={uploading !== null} onClick={() => void remove(a.kind)}>
                  Remove
                </Button>
              )}
            </div>
          );
        })}
        <p className="text-xs text-text-tertiary">
          PNG or SVG, up to 1 MB and 2048 px per side. Favicon: square PNG, at least 32 px.
        </p>
      </section>
    </div>
  );
}
