import { Injectable, Logger } from '@nestjs/common';
import { buildStaffProfile, recordApiRequest, resolveStaffForLookup } from '@kku/db';
import {
  ApiError,
  STAFF_PROFILE_API_VERSION,
  StaffProfileLookupSchema,
  type ApiMeta,
  type StaffProfileResponseData,
} from '@kku/shared';
import type { ApiLookupType } from '@kku/db';
import { requestIdOf, type ApiClientRequest } from './api-key.guard';
import { toStaffProfileResponse } from './staff-profile.mapper';
import { statusForCode } from '../common/exception.filter';

const CAVEATS = [
  'teaching.totals.studentsTaught is the sum of enrolled seats across sections over the window: a student taking two of this person\'s courses is counted twice.',
  'research.hIndex and totalCitations are computed from the per-paper citation counts in the publication list; papers without an indexed citation count contribute 0.',
  'research.basis is google-scholar once any Google Scholar import exists for this person; the list is then Scholar papers plus library papers Scholar matched.',
];

@Injectable()
export class StaffProfileService {
  private readonly logger = new Logger(StaffProfileService.name);

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
      const profile = facultyMemberId ? await buildStaffProfile(facultyMemberId, { courseLimit: null }) : null;
      if (!profile) {
        facultyMemberId = null;
        throw new ApiError('NOT_FOUND', 'Staff member not found');
      }

      const mapped = toStaffProfileResponse(profile, client);
      status = 200;
      sectionsReturned = mapped.included;
      return {
        data: mapped.data,
        meta: {
          freshnessDate: profile.publicationsFetchedAt,
          methodologyVersion: STAFF_PROFILE_API_VERSION,
          sources: [
            { id: 'kku-hr', name: 'KKU HR (staff record)' },
            { id: 'unicon-ds2003', name: 'UNICON DS2003 (education history)' },
            { id: 'kku-registry', name: 'KKU Registrar (class offerings)' },
            { id: 'kku-publications', name: 'KKU Publications mirror (Scopus, PubMed)' },
            { id: 'google-scholar', name: 'Google Scholar (on-demand import)' },
          ],
          caveats: CAVEATS,
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
