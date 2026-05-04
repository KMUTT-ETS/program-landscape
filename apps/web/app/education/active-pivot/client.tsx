'use client';

import { Card } from '@kku/ui';
import { DrillDownPivot } from '../drill-down-pivot';
import type { ActivePivotResponse } from '../types';

interface Props {
  data: ActivePivotResponse;
}

export function ActivePivotClient({ data }: Props) {
  return (
    <Card>
      <DrillDownPivot
        columns={data.entryYears}
        columnLabel={(c) => `BE ${c}`}
        rows={data.rows}
        totals={data.totals}
        leafLevel="program"
        rowHeaderLabel="Faculty / Program level / Program"
        totalLabel="Total active"
      />
    </Card>
  );
}
