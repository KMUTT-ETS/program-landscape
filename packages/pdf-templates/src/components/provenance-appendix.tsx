import { Section } from './section';

export interface ProvenanceEntry {
  id: string;
  label: string;
  source: string;
  freshnessDate?: string;   // human-friendly e.g. "22 เม.ย. 2569"
  url?: string;
  methodologyVersion?: string;
  note?: string;
}

export interface ProvenanceAppendixProps {
  entries: ProvenanceEntry[];
}

// Mirror of the in-app ProvenanceDrawer: every chart/metric cited in the
// body has a row here with its source + freshness + methodology version.
// This is how a Council member verifies a number they see on page 3
// without calling the analyst.
export function ProvenanceAppendix({ entries }: ProvenanceAppendixProps) {
  return (
    <Section title="แหล่งข้อมูลและระเบียบวิธี" breakBefore>
      <table>
        <thead>
          <tr>
            <th style={{ width: '28%' }}>ตัวชี้วัด / แผนภูมิ</th>
            <th style={{ width: '28%' }}>แหล่งข้อมูล</th>
            <th style={{ width: '16%' }}>ข้อมูล ณ</th>
            <th style={{ width: '14%' }}>ระเบียบวิธี</th>
            <th style={{ width: '14%' }}>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{e.label}</td>
              <td>{e.source}</td>
              <td>{e.freshnessDate ?? '—'}</td>
              <td>{e.methodologyVersion ?? '—'}</td>
              <td>{e.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
