export function AtlasTable({
  rows,
  first = 'Programme',
}: {
  rows: Array<{ id: string; label: string; values: Record<string, number | string | null> }>;
  first?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-text-tertiary">No rows.</p>;
  const keys = Object.keys(rows[0]!.values);
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-surface-2 text-text-tertiary">
        <tr>
          <th className="px-2 py-1 text-left">{first}</th>
          {keys.map((k) => (
            <th key={k} className="px-2 py-1 text-right">{k}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-subtle">
            <td className="px-2 py-1 text-text-primary">{r.label}</td>
            {keys.map((k) => (
              <td key={k} className="px-2 py-1 text-right font-tabular text-text-secondary">
                {r.values[k] === null ? '—' : typeof r.values[k] === 'number' ? (r.values[k] as number).toLocaleString('en-US') : r.values[k]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
