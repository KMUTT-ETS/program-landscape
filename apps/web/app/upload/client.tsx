'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
} from '@kku/ui';
import { FileUp, Upload } from 'lucide-react';

// Drag-and-drop multi-file upload against /api/admin-pdfs/upload (the
// Next.js proxy → NestJS /pdfs/upload). Keeps per-file progress locally
// in component state; once all files are done, offers a "Go to review
// queue" link.

type FileStatus =
  | { state: 'queued' }
  | { state: 'uploading' }
  | {
      state: 'done';
      pdfDocumentId: string;
      deduplicated: boolean;
    }
  | { state: 'failed'; message: string };

interface FileEntry {
  file: File;
  key: string;
  status: FileStatus;
}

const CATEGORY_OPTIONS = [
  { value: '', label: 'Auto-classify' },
  { value: 'POLICY', label: 'Policy document' },
  { value: 'REPORT', label: 'Report / statistical' },
  { value: 'CURRICULUM', label: 'Curriculum (มคอ.2 / มคอ.3)' },
  { value: 'PEER_PROGRAM', label: 'Peer program brochure' },
  { value: 'SURVEY', label: 'Survey results' },
  { value: 'COMMITTEE_MINUTES', label: 'Committee minutes' },
  { value: 'JOB_POSTINGS_BATCH', label: 'Job postings batch' },
  { value: 'OTHER', label: 'Other' },
];

export function UploadClient() {
  const router = useRouter();
  const [files, setFiles] = React.useState<FileEntry[]>([]);
  const [sourceCategory, setSourceCategory] = React.useState('');
  const [sourceOrg, setSourceOrg] = React.useState('');
  const [language, setLanguage] = React.useState<'' | 'TH' | 'EN' | 'MIXED'>('');
  const [dragOver, setDragOver] = React.useState(false);

  const addFiles = (incoming: FileList | File[]) => {
    const list: FileEntry[] = [...incoming]
      .filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
      .map((file) => ({
        file,
        key: `${file.name}-${file.size}-${file.lastModified}`,
        status: { state: 'queued' } as FileStatus,
      }));
    setFiles((prev) => {
      const seen = new Set(prev.map((p) => p.key));
      return [...prev, ...list.filter((l) => !seen.has(l.key))];
    });
  };

  const uploadAll = async () => {
    // One request per file keeps progress reporting straightforward.
    // Batching would be faster but the per-file feedback matters more
    // here — an analyst wants to know which of 12 PDFs failed.
    for (const entry of files) {
      if (entry.status.state !== 'queued' && entry.status.state !== 'failed') continue;
      setFiles((prev) =>
        prev.map((p) => (p.key === entry.key ? { ...p, status: { state: 'uploading' } } : p)),
      );
      try {
        const form = new FormData();
        form.append('files', entry.file);
        if (sourceCategory) form.append('sourceCategoryHint', sourceCategory);
        if (sourceOrg) form.append('sourceOrg', sourceOrg);
        if (language) form.append('language', language);

        const res = await fetch('/api/admin-pdfs/upload', {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const msg = `HTTP ${res.status}`;
          setFiles((prev) =>
            prev.map((p) =>
              p.key === entry.key ? { ...p, status: { state: 'failed', message: msg } } : p,
            ),
          );
          continue;
        }
        const body = (await res.json()) as {
          data: { uploaded: Array<{ pdfDocumentId: string; deduplicated: boolean }> };
        };
        const first = body.data.uploaded[0];
        if (!first) throw new Error('Server returned empty uploaded array');
        setFiles((prev) =>
          prev.map((p) =>
            p.key === entry.key
              ? {
                  ...p,
                  status: {
                    state: 'done',
                    pdfDocumentId: first.pdfDocumentId,
                    deduplicated: first.deduplicated,
                  },
                }
              : p,
          ),
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((p) =>
            p.key === entry.key
              ? { ...p, status: { state: 'failed', message: (err as Error).message } }
              : p,
          ),
        );
      }
    }
    toast.success('Upload complete. New PDFs are processing in the background.');
    router.refresh();
  };

  const allDone = files.length > 0 && files.every((f) => f.status.state === 'done');

  return (
    <div className="flex flex-col gap-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
        }}
        className={`flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed ${
          dragOver ? 'border-accent bg-accent-subtle' : 'border-border-default bg-surface-1'
        } p-8 text-center transition-colors`}
      >
        <FileUp className="h-8 w-8 text-text-tertiary" aria-hidden />
        <div className="text-sm text-text-secondary">
          Drag PDFs here, or{' '}
          <label className="cursor-pointer text-accent underline">
            browse
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
              }}
            />
          </label>
        </div>
        <div className="text-xs text-text-tertiary">
          Max 50&nbsp;MB per file, up to 20 files per batch.
        </div>
      </div>

      {/* Shared metadata for this batch */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label>Category (optional hint)</Label>
          <select
            value={sourceCategory}
            onChange={(e) => setSourceCategory(e.target.value)}
            className="kku-select"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Source organisation</Label>
          <Input
            value={sourceOrg}
            onChange={(e) => setSourceOrg(e.target.value)}
            placeholder="MHESI / NESDC / NSO / KKU Engineering / …"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Language</Label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
            className="kku-select"
          >
            <option value="">Auto-detect</option>
            <option value="TH">Thai</option>
            <option value="EN">English</option>
            <option value="MIXED">Mixed</option>
          </select>
        </div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <Card padding="none">
          <div className="divide-y divide-border-subtle">
            {files.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{f.file.name}</span>
                  <span className="font-tabular text-xs text-text-tertiary">
                    {(f.file.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <StatusBadge status={f.status} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={() => void uploadAll()} disabled={files.length === 0 || allDone}>
          <Upload className="h-4 w-4" aria-hidden />
          {allDone ? 'All uploaded' : `Upload ${files.length} file${files.length === 1 ? '' : 's'}`}
        </Button>
        {allDone && (
          <Button variant="outline" onClick={() => router.push('/admin/pdf-review')}>
            Go to review queue
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: FileStatus }) {
  switch (status.state) {
    case 'queued':
      return <Badge tone="neutral">queued</Badge>;
    case 'uploading':
      return <Badge tone="info">uploading…</Badge>;
    case 'done':
      return status.deduplicated ? (
        <Badge tone="warning">already in library</Badge>
      ) : (
        <Badge tone="success">uploaded</Badge>
      );
    case 'failed':
      return <Badge tone="danger">failed: {status.message}</Badge>;
  }
}
