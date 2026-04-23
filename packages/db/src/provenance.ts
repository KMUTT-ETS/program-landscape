import type { ProvenanceEntry } from '@kku/shared';
import { prisma } from './index';

// getProvenance(entityType, entityId) — the single provenance lookup
// helper. The in-app ProvenanceDrawer and the PDF ProvenanceAppendix
// both call this; do NOT re-roll equivalent logic in modules.
//
// Current capabilities (v1, matches what the schema can answer today):
//
//   entityType = 'pdf_document'
//     Returns the IngestionRun that created the PdfDocument (and thus
//     the DataSource it came from). PDF extractions flowing through
//     prompt 03b attach the PdfDocument.id to downstream domain rows;
//     modules should route those back through this entityType.
//
//   entityType = 'data_source'
//     Returns the DataSource itself. Useful when a chart's provenance is
//     just "this line comes from KKU Finance" without a per-row entity.
//
//   entityType = <anything else>
//     Best-effort fallback: returns the DataSource(s) whose most recent
//     SUCCEEDED IngestionRun wrote to the table matching `entityType`.
//     Real rows today don't carry an ingestion_run_id FK, so this is
//     table-level, not row-level. Prompt 14 (real data integration)
//     will add per-row ingestion_run_id columns to the metric tables
//     and this function will grow a dedicated branch per entity type.
//
// Returns an empty array when nothing is known — modules should treat
// that as "provenance unavailable" rather than throwing, so the drawer
// can render an "unknown source" placeholder without crashing.

export async function getProvenance(
  entityType: string,
  entityId: string,
): Promise<ProvenanceEntry[]> {
  switch (entityType) {
    case 'pdf_document':
      return provenanceForPdfDocument(entityId);
    case 'data_source':
      return provenanceForDataSourceId(entityId);
    default:
      return provenanceForTable(entityType);
  }
}

async function provenanceForPdfDocument(pdfDocumentId: string): Promise<ProvenanceEntry[]> {
  const pdf = await prisma.pdfDocument.findUnique({
    where: { id: pdfDocumentId },
    select: {
      id: true,
      sourceOrg: true,
      uploadedAt: true,
    },
  });
  if (!pdf) return [];

  // The IngestionRun that created (or most recently touched) this PDF.
  const run = await prisma.ingestionRun.findFirst({
    where: { pdfDocumentId, status: 'SUCCEEDED' },
    orderBy: { createdAt: 'desc' },
    include: { dataSource: true },
  });

  if (run) {
    return [toEntry(run.dataSource, run.completedAt ?? run.createdAt, pdf.id)];
  }

  // Fallback: the PDF exists but no IngestionRun recorded it (hand
  // uploaded via admin, arrived before the ingestion framework). The
  // sourceOrg text is what we have.
  if (pdf.sourceOrg) {
    return [
      {
        sourceId: 'inline',
        sourceSlug: 'manual',
        sourceName: pdf.sourceOrg,
        freshnessDate: pdf.uploadedAt,
        lastSyncedAt: null,
        sourcePdfId: pdf.id,
        methodologyVersion: null,
      },
    ];
  }

  return [];
}

async function provenanceForDataSourceId(id: string): Promise<ProvenanceEntry[]> {
  const ds = await prisma.dataSource.findUnique({ where: { id } });
  if (!ds) return [];
  return [toEntry(ds, ds.lastSyncedAt)];
}

async function provenanceForTable(tableName: string): Promise<ProvenanceEntry[]> {
  // Grab up to 5 recent successful runs that wrote to this target. We
  // can't query "which runs wrote to table X" today — IngestionRun has
  // no target column — so the current implementation returns the most
  // recent SUCCEEDED run across the whole queue as a best-effort
  // placeholder. Modules that need stronger guarantees must either
  // use entityType='pdf_document' (precise) or wait for prompt 14.
  //
  // Intentionally conservative: we don't fabricate a source list.
  // Better to return empty than mislead a Council member about where
  // a number came from.
  if (!tableName) return [];

  const recent = await prisma.ingestionRun.findMany({
    where: { status: 'SUCCEEDED' },
    orderBy: { completedAt: 'desc' },
    take: 5,
    include: { dataSource: true },
  });
  const seen = new Set<string>();
  const entries: ProvenanceEntry[] = [];
  for (const r of recent) {
    if (seen.has(r.dataSourceId)) continue;
    seen.add(r.dataSourceId);
    entries.push(toEntry(r.dataSource, r.completedAt ?? r.createdAt));
  }
  return entries;
}

function toEntry(
  ds: {
    id: string;
    slug: string;
    name: string;
    lastSyncedAt: Date | null;
  },
  freshnessDate: Date | null,
  sourcePdfId?: string,
): ProvenanceEntry {
  return {
    sourceId: ds.id,
    sourceSlug: ds.slug,
    sourceName: ds.name,
    freshnessDate,
    lastSyncedAt: ds.lastSyncedAt,
    sourcePdfId: sourcePdfId ?? null,
    methodologyVersion: null,
  };
}
