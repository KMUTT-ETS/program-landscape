'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Badge } from '@kku/ui';
import { Building2, AlertTriangle } from 'lucide-react';
import { readSaveResponse } from './save-response';

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
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}
export interface AdminOrganizationResponse {
  profile: OrganizationProfileDto | null;
}
interface TcasMatch {
  exactRows: number;
  suggestions: { name: string; rows: number; similarity: number }[];
}

type FormState = {
  nameTh: string; nameEn: string; shortNameTh: string; shortNameEn: string;
  regionTh: string; regionEn: string; contactEmail: string; appUrl: string;
};

function toForm(p: OrganizationProfileDto | null): FormState {
  return {
    nameTh: p?.nameTh ?? '', nameEn: p?.nameEn ?? '', shortNameTh: p?.shortNameTh ?? '',
    shortNameEn: p?.shortNameEn ?? '', regionTh: p?.regionTh ?? '', regionEn: p?.regionEn ?? '',
    contactEmail: p?.contactEmail ?? '', appUrl: p?.appUrl ?? '',
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
  const [tcas, setTcas] = useState<TcasMatch | null>(null);

  async function checkTcas() {
    if (!form.nameTh.trim()) return;
    try {
      const res = await fetch(`/api/admin-organization/tcas-match?name=${encodeURIComponent(form.nameTh)}`);
      if (res.ok) setTcas((await res.json()).data as TcasMatch);
    } catch {
      // The TCAS hint is advisory; a network error just leaves it blank.
    }
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
              type={f.key === 'contactEmail' ? 'email' : f.key === 'appUrl' ? 'url' : 'text'}
              onChange={(e) => {
                setForm({ ...form, [f.key]: e.target.value });
                // A TCAS badge describes the old Thai name; drop it until re-checked.
                if (f.key === 'nameTh') setTcas(null);
              }}
              onBlur={f.key === 'nameTh' ? () => void checkTcas() : undefined}
              className="rounded-md border border-default bg-surface-1 px-2 py-1"
            />
            {f.hint && <span className="text-xs text-text-tertiary">{f.hint}</span>}
            {f.key === 'nameTh' && tcas && (
              <span className="text-xs">
                {tcas.exactRows > 0 ? (
                  <Badge tone="success">Matches {tcas.exactRows} TCAS rows</Badge>
                ) : (
                  <>
                    <Badge tone="warning">No TCAS rows match exactly</Badge>{' '}
                    {tcas.suggestions.length > 0 && (
                      <span className="text-text-secondary">
                        Closest: {tcas.suggestions.slice(0, 3).map((s) => `${s.name} (${s.rows})`).join(' · ')}
                      </span>
                    )}
                  </>
                )}
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
    </div>
  );
}
