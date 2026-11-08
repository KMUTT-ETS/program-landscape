import { Injectable, Logger } from '@nestjs/common';
import {
  buildStaffProfile,
  getStaffGrants,
  getStaffTeachingEvaluation,
  grantsSourceCredits,
  recordApiRequest,
  resolveStaffForLookup,
} from '@kku/db';
import {
  ApiError,
  STAFF_PROFILE_API_VERSION,
  StaffProfileLookupSchema,
  StaffProfileResponseDataSchema,
  type ApiMeta,
  type StaffGrantsSummary,
  type StaffProfileResponseData,
  type TeachingEvaluationSummary,
} from '@kku/shared';
import type { ApiLookupType, StaffProfile } from '@kku/db';
import { requestIdOf, type ApiClientRequest } from './api-key.guard';
import { toStaffProfileResponse } from './staff-profile.mapper';
import { statusForCode } from '../common/exception.filter';
import { AsyncSemaphore } from '../common/semaphore';

const CAVEATS = [
  'teaching.totals.studentsTaught is the sum of enrolled seats across sections over the window: a student taking two of this person\'s courses is counted twice.',
  'research.hIndex and totalCitations are computed from the per-paper citation counts in the publication list; papers without an indexed citation count contribute 0.',
  'research.basis is google-scholar once any Google Scholar import exists for this person; the list is then Scholar papers plus library papers Scholar matched.',
];

/** Said only when the teachingEvaluation section is actually returned. */
const EVALUATION_CAVEATS = [
  'Teaching ratings are on a 1–5 scale; category scores are respondent-weighted means of their questions.',
  'teachingEvaluation.totalAnswers counts answers, one per question answered, not students.',
];

/** Said only when the grants section is actually returned. */
const GRANTS_CAVEATS = [
  'grants.projects[].budgetThb is the whole project budget, not this person\'s share.',
  'grants covers externally funded projects recorded in the institution research and academic-services system, synced daily.',
  'grants.active counts projects whose start and end dates include today (Bangkok); projects missing either date are not counted.',
];

const BASE_SOURCES = [
  { id: 'kku-hr', name: 'HR (staff record)' },
  { id: 'unicon-ds2003', name: 'UNICON DS2003 (education history)' },
  { id: 'kku-registry', name: 'Registrar (class offerings)' },
  { id: 'kku-publications', name: 'Publications mirror (Scopus, PubMed)' },
  { id: 'google-scholar', name: 'Google Scholar (on-demand import)' },
];
const EVALUATION_SOURCE = { id: 'kku-evaluations', name: 'Student course evaluations' };

/**
 * A cold build fans out to the publications mirror, Scopus, OpenAlex and the
 * registrar cubes, so an external caller looping over its staff list must not
 * be able to start an unbounded number at once. Env override
 * `STAFF_PROFILE_MAX_CONCURRENT_BUILDS`; default 4.
 */
export function staffProfileMaxConcurrentBuilds(): number {
  const raw = Number(process.env.STAFF_PROFILE_MAX_CONCURRENT_BUILDS);
  return Number.isInteger(raw) && raw > 0 ? raw : 4;
}

@Injectable()
export class StaffProfileService {
  private readonly logger = new Logger(StaffProfileService.name);
  private readonly builds = new AsyncSemaphore(staffProfileMaxConcurrentBuilds());
  /** One in-flight build per staff record: concurrent lookups of the same
   *  person share it rather than each paying for (and queueing) a build. */
  private readonly inFlight = new Map<string, Promise<StaffProfile | null>>();
  /** Same coalescing for the teaching-evaluation load (one query family, so
   *  it runs beside the bounded build rather than taking a build slot). */
  private readonly evaluationsInFlight = new Map<string, Promise<TeachingEvaluationSummary | null>>();

  /** Coalesces concurrent grants loads for the same person, like evaluationsInFlight. */
  private readonly grantsInFlight = new Map<string, Promise<StaffGrantsSummary>>();

  private grantsOnce(facultyMemberId: string): Promise<StaffGrantsSummary> {
    const existing = this.grantsInFlight.get(facultyMemberId);
    if (existing) return existing;
    const p = getStaffGrants(facultyMemberId).finally(() => this.grantsInFlight.delete(facultyMemberId));
    this.grantsInFlight.set(facultyMemberId, p);
    return p;
  }

  private evaluationOnce(facultyMemberId: string): Promise<TeachingEvaluationSummary | null> {
    const existing = this.evaluationsInFlight.get(facultyMemberId);
    if (existing) return existing;
    const p = getStaffTeachingEvaluation(facultyMemberId).finally(() =>
      this.evaluationsInFlight.delete(facultyMemberId),
    );
    this.evaluationsInFlight.set(facultyMemberId, p);
    return p;
  }

  private buildOnce(facultyMemberId: string): Promise<StaffProfile | null> {
    const existing = this.inFlight.get(facultyMemberId);
    if (existing) return existing;
    const p = (async () => {
      const release = await this.builds.acquire();
      try {
        // The API never returns the Teaching Talent verdict, so skip computing it.
        return await buildStaffProfile(facultyMemberId, { courseLimit: null, includeTalent: false });
      } finally {
        release();
      }
    })().finally(() => this.inFlight.delete(facultyMemberId));
    this.inFlight.set(facultyMemberId, p);
    return p;
  }

  async lookup(
    req: ApiClientRequest,
    body: unknown,
  ): Promise<{ data: StaffProfileResponseData; meta: Partial<ApiMeta> }> {
    // ApiKeyGuard sets this on every @ApiKeyAuth() route; refuse rather than
    // trust that if the service is ever reached another way.
    if (!req.apiClient) throw new ApiError('UNAUTHORIZED', 'Invalid or missing API key');
    const started = Date.now();
    const { client, keyId } = req.apiClient;
    let lookupType: ApiLookupType | null = null;
    let facultyMemberId: string | null = null;
    let sectionsReturned: string[] = [];
    let status = 500;

    try {
      const parsed = StaffProfileLookupSchema.safeParse(body);
      if (!parsed.success) {
        // Paths and messages only — never the received value.
        throw new ApiError('VALIDATION_FAILED', 'Request validation failed', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const lookup = parsed.data;
      lookupType = 'citizenId' in lookup ? 'CITIZEN_ID' : 'EMAIL';
      const permitted = lookupType === 'CITIZEN_ID' ? client.allowCitizenIdLookup : client.allowEmailLookup;
      if (!permitted) {
        throw new ApiError('FORBIDDEN', 'This client may not look staff up by that identifier', {
          reason: 'lookup_not_permitted',
        });
      }

      facultyMemberId = await resolveStaffForLookup(lookup, { includeInactive: client.includeInactive });
      // Performance data: loaded only for a client granted the section, never
      // fetched and then filtered out.
      const wantsEvaluation = client.allowedSections.includes('teachingEvaluation');
      const evaluation =
        facultyMemberId && wantsEvaluation ? this.evaluationOnce(facultyMemberId) : undefined;
      // Observe a rejection now so a 404 below never leaves it unhandled; the
      // await further down still throws it.
      evaluation?.catch(() => undefined);
      const wantsGrants = client.allowedSections.includes('grants');
      const grantsP = facultyMemberId && wantsGrants ? this.grantsOnce(facultyMemberId) : undefined;
      grantsP?.catch(() => undefined);
      const profile = facultyMemberId ? await this.buildOnce(facultyMemberId) : null;
      if (!profile) {
        facultyMemberId = null;
        throw new ApiError('NOT_FOUND', 'Staff member not found');
      }
      // A granted section that cannot be loaded fails the request (500 via the
      // catch below) rather than being silently dropped from the answer.
      const extras = {
        ...(evaluation ? { teachingEvaluation: await evaluation } : {}),
        ...(grantsP ? { grants: await grantsP } : {}),
      };

      const mapped = toStaffProfileResponse(profile, client, extras);
      const evaluationReturned = mapped.included.includes('teachingEvaluation');
      const grantsReturned = mapped.included.includes('grants');
      const sources = [
        ...BASE_SOURCES,
        ...(evaluationReturned ? [EVALUATION_SOURCE] : []),
        ...(grantsReturned ? await grantsSourceCredits() : []),
      ];
      const caveats = [
        ...CAVEATS,
        ...(evaluationReturned ? EVALUATION_CAVEATS : []),
        ...(grantsReturned ? GRANTS_CAVEATS : []),
      ];
      // Runtime check of the wire shape. A drift is logged and the data still
      // returned: failing a caller over our own schema lag would be worse.
      // Issue paths only — never the values, which are personal data.
      const check = StaffProfileResponseDataSchema.safeParse(mapped.data);
      if (!check.success) {
        const paths = [...new Set(check.error.issues.map((i) => i.path.join('.')))];
        this.logger.warn(`staff-profile response failed its schema at: ${paths.join(', ')}`);
      }
      status = 200;
      sectionsReturned = mapped.included;
      return {
        data: mapped.data,
        meta: {
          freshnessDate: profile.publicationsFetchedAt,
          methodologyVersion: STAFF_PROFILE_API_VERSION,
          sources,
          caveats,
          integration: {
            apiVersion: STAFF_PROFILE_API_VERSION,
            generatedAt: new Date().toISOString(),
            publicationsCache: profile.publicationsCache,
            sectionsIncluded: mapped.included,
            sectionsWithheld: mapped.withheld,
          },
        },
      };
    } catch (err) {
      // Log the status the exception filter will actually send.
      status = err instanceof ApiError ? statusForCode(err.code) : 500;
      throw err;
    } finally {
      recordApiRequest({
        clientId: client.id,
        keyId,
        lookupType,
        facultyMemberId,
        status,
        sectionsReturned,
        latencyMs: Date.now() - started,
        ip: req.ip ?? null,
        requestId: requestIdOf(req),
      }).catch((err: unknown) =>
        this.logger.warn(`could not log API request: ${(err as Error).message}`),
      );
    }
  }
}
