import { Injectable, Optional } from '@nestjs/common';
import {
  getGrantProjectDetail,
  getGrantsDashboard,
  grantsFreshness,
  grantsSourceCredits,
  type GrantsFilter,
} from '@kku/db';
import { ApiError, type ApiMeta } from '@kku/shared';
import { CacheService } from '../common/cache.service';

const CAVEATS = [
  'Faculty figures count a project for every faculty with a team member on it, so they add up to more than the KKU total.',
  'Budget is the whole project budget. It is not split between team members or faculties.',
  'Covers externally funded projects only (ทุนภายนอก). วิทยาลัยการปกครองท้องถิ่น holds about a third of all projects, mostly small academic-service projects — compare money as well as counts.',
  'Staff are matched to HR records by citizen-id hash or email (leads) and HR employee id (co-investigators); unmatched people still count in project totals.',
];

/**
 * Faculty restriction for one project's detail. `clamped` is what
 * clampFacultyNameFilter returned for an empty filter: null = no grants at all
 * (match nothing), empty = all-scope (no restriction), otherwise the granted
 * faculty names.
 */
export function detailScopeNames(clamped: { facultyName: string[] } | null): string[] | null {
  if (clamped === null) return ['__none__'];
  return clamped.facultyName.length > 0 ? clamped.facultyName : null;
}

@Injectable()
export class GrantsService {
  constructor(@Optional() private readonly cache?: CacheService) {}

  async dashboard(
    f: GrantsFilter,
  ): Promise<{ data: Awaited<ReturnType<typeof getGrantsDashboard>>; meta: ApiMeta }> {
    const [fresh, sources] = await Promise.all([grantsFreshness(), grantsSourceCredits()]);
    // The run id is in the key, so the next daily sync invalidates every entry.
    // keyOf sorts keys but not array contents, so sort the list filters here:
    // the same selection in a different order must hit the same entry.
    const key = CacheService.keyOf('staff:grants-v1', {
      ...f,
      facultyName: [...f.facultyName].sort(),
      type: f.type ? [...f.type].sort() : undefined,
      funder: f.funder ? [...f.funder].sort() : undefined,
      run: fresh?.runId ?? 'none',
    });
    const cached = await this.cache?.get<Awaited<ReturnType<typeof getGrantsDashboard>>>(key);
    const data = cached ?? (await getGrantsDashboard(f));
    if (!cached) await this.cache?.set(key, data, 60 * 30);
    const { membersMatched, membersTotal } = data.kpis;
    const pct = membersTotal ? Math.round((membersMatched / membersTotal) * 100) : 0;
    const meta: ApiMeta = {
      freshnessDate: fresh?.completedAt.toISOString() ?? null,
      sources,
      caveats: CAVEATS,
      methodologyParameters: [
        {
          label: 'Staff matched to HR records',
          value: `${membersMatched} of ${membersTotal} team members (${pct}%)`,
        },
      ],
    };
    return { data, meta };
  }

  async detail(id: string, facultyNames: string[] | null) {
    const [d, fresh, sources] = await Promise.all([
      getGrantProjectDetail(id, facultyNames),
      grantsFreshness(),
      grantsSourceCredits(),
    ]);
    if (!d) throw new ApiError('NOT_FOUND', 'Project not found');
    const meta: ApiMeta = {
      freshnessDate: fresh?.completedAt.toISOString() ?? null,
      sources,
      caveats: CAVEATS,
    };
    return { data: d, meta };
  }
}
