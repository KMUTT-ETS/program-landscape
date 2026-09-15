import { Injectable } from '@nestjs/common';
import {
  recordPageView,
  usageActions,
  usageByModule,
  usageByProgram,
  usageByRole,
  usageByViewerFaculty,
  usageMedianDwell,
  usageProgramViewers,
  usageSummary,
  usageUserTimeline,
  usageUsers,
  type ActionUsage,
  type ModuleUsage,
  type ProgramUsage,
  type ProgramViewer,
  type RecordPageViewInput,
  type RoleUsage,
  type UsageSummary,
  type UsageUsersOptions,
  type UsageUsersResult,
  type UsageWindowDays,
  type UserTimeline,
  type ViewerFacultyUsage,
} from '@kku/db';

import { CacheService } from '../common/cache.service';

// ─────────────────────────────────────────────────────────────────────────
// Usage reads.
//
// Aggregate reads are cached for five minutes: they scan the whole window
// and nobody reading a 30-day trend needs the last five minutes of it. The
// key carries every argument that changes the answer — window, admin
// exclusion, and any scope filter — because two of these differ only by an
// argument, and a key that drops one serves the wrong figure silently.
//
// Detail reads are NEVER cached. They are per-person records read under
// usage:read:detail, they are small, and a stale answer on a page about
// one named individual is worse than a slow one.
// ─────────────────────────────────────────────────────────────────────────

const AGGREGATE_TTL_SECONDS = 300;

@Injectable()
export class UsageService {
  constructor(private readonly cache: CacheService) {}

  /** Throws on a database error — the controller decides what that means. */
  record(input: RecordPageViewInput): Promise<void> {
    return recordPageView(input);
  }

  private async cached<T>(
    namespace: string,
    args: Record<string, unknown>,
    compute: () => Promise<T>,
  ): Promise<T> {
    const key = CacheService.keyOf(`usage:${namespace}`, args);
    const hit = await this.cache.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await compute();
    await this.cache.set(key, value, AGGREGATE_TTL_SECONDS);
    return value;
  }

  summary(
    days: UsageWindowDays,
    excludeAdmins: boolean,
  ): Promise<UsageSummary & { medianDwellMs: number | null }> {
    return this.cached('summary', { days, excludeAdmins }, async () => {
      const [summary, medianDwellMs] = await Promise.all([
        usageSummary(days, excludeAdmins),
        usageMedianDwell(days, excludeAdmins),
      ]);
      return { ...summary, medianDwellMs };
    });
  }

  modules(days: UsageWindowDays, excludeAdmins: boolean): Promise<ModuleUsage[]> {
    return this.cached('modules', { days, excludeAdmins }, () =>
      usageByModule(days, excludeAdmins),
    );
  }

  programs(
    days: UsageWindowDays,
    excludeAdmins: boolean,
    facultyId: string | null,
  ): Promise<ProgramUsage[]> {
    return this.cached('programs', { days, excludeAdmins, facultyId }, () =>
      usageByProgram(days, excludeAdmins, facultyId),
    );
  }

  roles(days: UsageWindowDays, excludeAdmins: boolean): Promise<RoleUsage[]> {
    return this.cached('roles', { days, excludeAdmins }, () => usageByRole(days, excludeAdmins));
  }

  faculties(days: UsageWindowDays, excludeAdmins: boolean): Promise<ViewerFacultyUsage[]> {
    return this.cached('faculties', { days, excludeAdmins }, () =>
      usageByViewerFaculty(days, excludeAdmins),
    );
  }

  actions(days: UsageWindowDays, excludeAdmins: boolean): Promise<ActionUsage[]> {
    return this.cached('actions', { days, excludeAdmins }, () => usageActions(days, excludeAdmins));
  }

  // ── Detail — uncached. ─────────────────────────────────────────────────

  users(
    days: UsageWindowDays,
    excludeAdmins: boolean,
    q: string | null,
    opts: UsageUsersOptions,
  ): Promise<UsageUsersResult> {
    return usageUsers(days, excludeAdmins, q, opts);
  }

  userTimeline(userId: string, days: UsageWindowDays): Promise<UserTimeline | null> {
    return usageUserTimeline(userId, days);
  }

  programViewers(programId: string, days: UsageWindowDays): Promise<ProgramViewer[]> {
    return usageProgramViewers(programId, days);
  }
}
