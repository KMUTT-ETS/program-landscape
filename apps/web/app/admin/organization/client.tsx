'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button, Badge } from '@kku/ui';
import { Building2, AlertTriangle } from 'lucide-react';
import { readSaveResponse } from './save-response';
import { BrandTab } from './brand-tab';

export interface OrganizationProfileDto {
  id: string;
  nameTh: string;
  nameEn: string;
  shortNameTh: string;
  shortNameEn: string;
  regionTh: string | null;
  regionEn: string | null;
  contactEmail: string | null;
  appUrl: string;
  intakeFloorBachelor: number;
  intakeFloorPostgrad: number;
  openalexInstitutionId: string | null;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
  logoLightKey: string | null;
  logoDarkKey: string | null;
  faviconKey: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}
export interface AdminOrganizationResponse {
  profile: OrganizationProfileDto | null;
}
// Admins check their Thai name against TCAS's own site; the platform no longer
// matches it, since a fresh install has no TCAS rows to compare against.
const TCAS_SITE_URL = 'https://course.mytcas.com/universities/';

type FormState = {
  nameTh: string; nameEn: string; shortNameTh: string; shortNameEn: string;
  regionTh: string; regionEn: string; contactEmail: string; appUrl: string;
  intakeFloorBachelor: string; intakeFloorPostgrad: string;
  openalexInstitutionId: string;
};

function toForm(p: OrganizationProfileDto | null): FormState {
  return {
    nameTh: p?.nameTh ?? '', nameEn: p?.nameEn ?? '', shortNameTh: p?.shortNameTh ?? '',
    shortNameEn: p?.shortNameEn ?? '', regionTh: p?.regionTh ?? '', regionEn: p?.regionEn ?? '',
    contactEmail: p?.contactEmail ?? '', appUrl: p?.appUrl ?? '',
    // Rendered as text so a cleared box stays cleared while typing; the
    // schema coerces back to a number on save.
    intakeFloorBachelor: String(p?.intakeFloorBachelor ?? 30),
    intakeFloorPostgrad: String(p?.intakeFloorPostgrad ?? 8),
    openalexInstitutionId: p?.openalexInstitutionId ?? '',
  };
}

const FIELDS: { key: keyof FormState; label: string; hint?: string; required?: boolean }[] = [
  { key: 'nameTh', label: 'Thai name', required: true,
    hint: 'Must match the สถาบัน column of the TCAS sheets character for character.' },
  { key: 'nameEn', label: 'English name', required: true,
    hint: 'As it appears in ranking tables and your Scopus affiliation.' },
  { key: 'shortNameTh', label: 'Thai short name', required: true },
  { key: 'shortNameEn', label: 'English short name', required: true, hint: 'Shown in the tagline and AI text.' },
  { key: 'regionTh', label: 'Region (Thai)' },
  { key: 'regionEn', label: 'Region (English)' },
  { key: 'contactEmail', label: 'Contact email',
    hint: 'Sent in outbound User-Agents so site operators can reach you. Never shown publicly.' },
  { key: 'appUrl', label: 'Public app URL', required: true },
  { key: 'intakeFloorBachelor', label: 'Minimum bachelor intake', required: true,
    hint: 'Your council\u2019s policy. A bachelor programme recruiting fewer than this each year is treated as closure-track in the health score and the risk register.' },
  { key: 'intakeFloorPostgrad', label: 'Minimum postgraduate intake', required: true,
    hint: 'The same policy for master\u2019s and doctoral programmes, where a small cohort is normal \u2014 below it a programme goes on the watch list rather than closure-track.' },
  { key: 'openalexInstitutionId', label: 'OpenAlex institution ID',
    hint: 'Used by the OpenAlex publications pull. Find it at openalex.org by searching your university, e.g. KMUTT I60837268. Leave blank to skip that connector.' },
];

export function OrganizationClient({
  initial,
  loadError,
}: {
  initial: AdminOrganizationResponse | null;
  loadError: string | null;
}) {
  const [profile, setProfile] = useState<OrganizationProfileDto | null>(initial?.profile ?? null);
  const [form, setForm] = useState<FormState>(toForm(initial?.profile ?? null));
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams?.get('tab') === 'brand' && profile ? 'brand' : 'identity';

  function selectTab(next: 'identity' | 'brand') {
    router.replace(next === 'brand' ? '?tab=brand' : '?tab=identity');
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin-organization', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, expectedVersion: profile?.version ?? null }),
      });
      const out = await readSaveResponse(res);
      if (res.status === 409 && out.errorCode === 'ORG_VERSION_CONFLICT') {
        toast.error('Someone else changed the organisation — reload the page and try again.');
        return;
      }
      if (out.errorMessage !== null) throw new Error(out.errorMessage);
      const next = (out.body as { profile: OrganizationProfileDto }).profile;
      setProfile(next);
      setForm(toForm(next));
      toast.success('Organisation saved. Other services pick it up within a minute.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-2">
        <Building2 className="size-icon-lg text-accent-default" aria-hidden />
        <h1 className="text-lg font-semibold">Organisation</h1>
        {profile && <Badge tone="info">version {profile.version}</Badge>}
      </header>

      {loadError && (
        <div className="rounded-md border border-[oklch(var(--color-danger-default)/0.4)] bg-danger/10 p-3 text-sm text-danger">
          {loadError}
        </div>
      )}

      {!profile && !loadError && (
        <div className="flex items-start gap-2 rounded-md border border-[oklch(var(--color-warning-default)/0.4)] bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-icon-md text-warning" aria-hidden />
          <span>
            The organisation is not configured yet. AI features and data connectors stay unavailable
            until you save this form.
          </span>
        </div>
      )}

      <div role="tablist" className="flex items-center gap-2 border-b border-default">
        {(['identity', 'brand'] as const).map((t) => {
          const disabled = t === 'brand' && !profile;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              disabled={disabled}
              onClick={() => selectTab(t)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm disabled:opacity-50 ${
                tab === t ? 'border-accent-default font-medium' : 'border-transparent text-text-secondary'
              }`}
            >
              {t === 'identity' ? 'Identity' : 'Brand'}
            </button>
          );
        })}
        {!profile && <span className="text-xs text-text-tertiary">Save the identity first.</span>}
      </div>

      {tab === 'brand' && profile && <BrandTab profile={profile} onSaved={setProfile} />}

      {tab === 'identity' && (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-sm">
            <span className="text-text-secondary">
              {f.label}
              {f.required ? ' *' : ''}
            </span>
            <input
              value={form[f.key]}
              required={f.required}
              type={
                f.key === 'contactEmail'
                  ? 'email'
                  : f.key === 'appUrl'
                    ? 'url'
                    : f.key.startsWith('intakeFloor')
                      ? 'number'
                      : 'text'
              }
              min={f.key.startsWith('intakeFloor') ? 1 : undefined}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              className="rounded-md border border-default bg-surface-1 px-2 py-1"
            />
            {f.hint && <span className="text-xs text-text-tertiary">{f.hint}</span>}
            {f.key === 'nameTh' && (
              <span className="text-xs text-text-tertiary">
                Check the spelling on{' '}
                <a
                  href={TCAS_SITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-default underline"
                >
                  the TCAS university list
                </a>
                .
              </span>
            )}
          </label>
        ))}
        <div>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : profile ? 'Save changes' : 'Create organisation'}
          </Button>
        </div>
      </form>
      )}
    </div>
  );
}
