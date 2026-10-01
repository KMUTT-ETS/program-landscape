// The metadata line under each APA citation on /profile: year, type, citation
// count, source and identifier links, plus an author-list note when the list
// is not complete. Stateless — rendered inside the client ProfileView.
import { ExternalLink, FileText, Quote } from 'lucide-react';
import type { PublicationEntry } from '@/lib/profile-types';
import { authorStatus, publicationTypeLabel, scopusRecordUrl, sourceLabel } from '@/lib/publication-meta';

type Lang = 'th' | 'en';

const L = {
  en: {
    cited: (n: number) => `Cited by ${n}`,
    shortened: 'list shortened by Google Scholar — full list on next sync',
    incomplete: 'author list incomplete',
    unavailable: 'co-authors unavailable',
  },
  th: {
    cited: (n: number) => `อ้างอิง ${n} ครั้ง`,
    shortened: 'Google Scholar แสดงรายชื่อผู้แต่งไม่ครบ — จะดึงรายชื่อเต็มในการซิงก์ครั้งถัดไป',
    incomplete: 'รายชื่อผู้แต่งไม่ครบ',
    unavailable: 'ไม่มีข้อมูลผู้แต่งร่วม',
  },
} as const;

function Sep() {
  return (
    <span aria-hidden className="text-text-tertiary">
      ·
    </span>
  );
}

export function PublicationMetaRow({ pub, lang }: { pub: PublicationEntry; lang: Lang }) {
  const l = L[lang];
  const type = publicationTypeLabel(pub.type, pub.source ?? null, lang);
  const source = sourceLabel(pub.source ?? null);
  const status = authorStatus({
    authors: pub.authors,
    authorsAreComplete: pub.authorsAreComplete,
    source: pub.source ?? null,
  });
  return (
    <div className="mt-[8px] space-y-[4px] text-xs">
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-text-tertiary">
        <span className="tabular-nums text-text-secondary">{pub.year}</span>
        {type && (
          <>
            <Sep />
            <span
              data-meta="type"
              className="inline-flex items-center gap-[4px] rounded-full border border-default px-[8px] py-[1px] text-text-secondary"
            >
              <FileText className="h-[12px] w-[12px]" aria-hidden />
              {type}
            </span>
          </>
        )}
        {pub.citations > 0 && (
          <>
            <Sep />
            <span data-meta="citations" className="inline-flex items-center gap-[4px] font-medium text-accent-default">
              <Quote className="h-[12px] w-[12px]" aria-hidden />
              {l.cited(pub.citations)}
            </span>
          </>
        )}
        {source && (
          <>
            <Sep />
            <span data-meta="source">{source}</span>
          </>
        )}
        {(pub.scopusId || pub.pmid) && (
          <span className="ml-auto inline-flex items-center gap-[12px]">
            {pub.scopusId && (
              <a
                href={scopusRecordUrl(pub.scopusId)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-[4px] text-accent-default hover:underline"
              >
                Scopus <ExternalLink className="h-[12px] w-[12px]" aria-hidden />
              </a>
            )}
            {pub.pmid && (
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-[4px] text-accent-default hover:underline"
              >
                PubMed <ExternalLink className="h-[12px] w-[12px]" aria-hidden />
              </a>
            )}
          </span>
        )}
      </div>
      {status !== 'complete' && (
        <div data-meta="authors" className="italic text-text-tertiary">
          {status === 'unavailable' ? l.unavailable : pub.source === 'google-scholar' ? l.shortened : l.incomplete}
        </div>
      )}
    </div>
  );
}
