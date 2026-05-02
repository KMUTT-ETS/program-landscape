'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, Card, Input, Label } from '@kku/ui';

interface Faculty { id: string; code: string; nameEn: string; nameTh: string }
interface Department {
  id: string; code: string; nameEn: string; nameTh: string; facultyId: string;
}

export function NewProgramClient({
  faculties,
  departments,
}: {
  faculties: Faculty[];
  departments: Department[];
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    code: '',
    nameTh: '',
    nameEn: '',
    facultyId: '',
    departmentId: '',
    level: 'BACHELOR' as 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
    yearEstablished: '',
  });

  const filteredDepts = form.facultyId
    ? departments.filter((d) => d.facultyId === form.facultyId)
    : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        code: form.code.trim(),
        nameTh: form.nameTh.trim(),
        nameEn: form.nameEn.trim(),
        facultyId: form.facultyId,
        departmentId: form.departmentId || null,
        level: form.level,
        yearEstablished: form.yearEstablished
          ? Number(form.yearEstablished)
          : null,
      };
      const res = await fetch('/api/admin-programs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      const created = json.data as { id: string };
      toast.success('Program created. Now attach the มคอ.2 PDF.');
      router.push(`/admin/programs/${created.id}`);
    } catch (err) {
      toast.error(`Failed to create program: ${(err as Error).message}`);
      setSaving(false);
    }
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label>Code *</Label>
            <Input
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="e.g. EN-CPE-BSC"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Level *</Label>
            <select
              value={form.level}
              onChange={(e) =>
                setForm({ ...form, level: e.target.value as typeof form.level })
              }
              className="kku-select"
            >
              <option value="BACHELOR">Bachelor</option>
              <option value="MASTER">Master</option>
              <option value="DOCTORAL">Doctoral</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label>Program name (Thai) *</Label>
            <Input
              required
              value={form.nameTh}
              onChange={(e) => setForm({ ...form, nameTh: e.target.value })}
              placeholder="หลักสูตรวิทยาศาสตรบัณฑิต สาขาวิชาเกษตรศาสตร์"
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label>Program name (English) *</Label>
            <Input
              required
              value={form.nameEn}
              onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
              placeholder="Bachelor of Science Program in Agriculture"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Faculty *</Label>
            <select
              required
              value={form.facultyId}
              onChange={(e) =>
                setForm({
                  ...form,
                  facultyId: e.target.value,
                  departmentId: '',
                })
              }
              className="kku-select"
            >
              <option value="">— Select faculty —</option>
              {faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nameEn}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Department</Label>
            <select
              value={form.departmentId}
              disabled={!form.facultyId}
              onChange={(e) =>
                setForm({ ...form, departmentId: e.target.value })
              }
              className="kku-select disabled:opacity-50"
            >
              <option value="">— None / Faculty-level —</option>
              {filteredDepts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameEn}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Year established (BE or CE)</Label>
            <Input
              type="number"
              value={form.yearEstablished}
              onChange={(e) =>
                setForm({ ...form, yearEstablished: e.target.value })
              }
              placeholder="e.g. 2508"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create program'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/admin/programs')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
