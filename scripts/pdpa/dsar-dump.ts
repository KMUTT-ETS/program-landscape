// DSAR row collectors, split from the CLI (scripts/pdpa/dsar.ts) so they can
// be tested against a stubbed client. Every function takes the Prisma client
// as a parameter; this module has no runtime imports of its own.
//
// Read-only. Row order is fixed by each query's orderBy; the CLI sorts keys.

import type { PrismaClient } from '@kku/db';

/** The page's user → staff-record bridge (`resolveFacultyMemberForUser` in
 *  @kku/db), injected so tests need not reach the real one. */
export type ResolveStaffForUser = (user: {
  employeeId: string | null;
  name: string | null;
}) => Promise<string | null>;

/** Staff-record-keyed personal data that is not keyed by citizen hash: the
 *  staff-profile publications cache, the external API's call log (which
 *  system looked this person up, and when), and research-service grant
 *  memberships. A lead row also carries the citizen hash and can be unmatched
 *  to any staff record, so the hash-keyed entry point passes `citizenIdHash`
 *  to catch those too. */
async function dumpByFacultyMemberIds(db: PrismaClient, ids: string[], citizenIdHash?: string) {
  const grantWhere = [
    ...(citizenIdHash ? [{ citizenIdHash }] : []),
    ...(ids.length > 0 ? [{ facultyMemberId: { in: ids } }] : []),
  ];
  const grantsQuery = () =>
    grantWhere.length === 0
      ? Promise.resolve([])
      : db.researchServiceProjectMember.findMany({
          where: { OR: grantWhere },
          orderBy: { id: 'asc' },
          include: { project: true },
        });
  if (ids.length === 0) {
    return {
      staffPublicationsCache: [],
      apiRequestLogs: [],
      researchServiceProjectMembers: await grantsQuery(),
    };
  }
  const [staffPublicationsCache, apiRequestLogs, researchServiceProjectMembers] = await Promise.all([
    db.staffPublicationsCache.findMany({
      where: { facultyMemberId: { in: ids } },
      orderBy: { facultyMemberId: 'asc' },
    }),
    db.apiRequestLog.findMany({
      where: { facultyMemberId: { in: ids } },
      orderBy: { createdAt: 'asc' },
      // The calling system's name is what a data subject needs; nothing
      // about its keys beyond the row's own key id.
      include: { client: { select: { name: true } } },
    }),
    grantsQuery(),
  ]);
  return { staffPublicationsCache, apiRequestLogs, researchServiceProjectMembers };
}

// ── Hash-keyed dump (covers HR / staff / DS2003 / lifecycle / grants) ────────
export async function dumpByCitizenHash(db: PrismaClient, hash: string) {
  const [
    facultyMembers,
    staffEducationHistory,
    staffLifecycleDates,
    staffMasterRecords,
    staffProgramAssignments,
    studentProgramRecords,
  ] = await Promise.all([
    db.facultyMember.findMany({
      where: { citizenIdHash: hash },
      orderBy: { id: 'asc' },
    }),
    db.staffEducationHistory.findMany({
      where: { citizenIdHash: hash },
      orderBy: [{ id: 'asc' }],
    }),
    db.staffLifecycleDates.findMany({
      where: { citizenIdHash: hash },
      orderBy: { citizenIdHash: 'asc' },
    }),
    db.staffMasterRecord.findMany({
      where: { citizenIdHash: hash },
      orderBy: [{ academicYear: 'asc' }, { semester: 'asc' }],
    }),
    db.staffProgramAssignment.findMany({
      where: { citizenIdHash: hash },
      orderBy: [{ academicYear: 'asc' }, { semester: 'asc' }, { id: 'asc' }],
    }),
    db.studentProgramRecord.findMany({
      where: { citizenIdHash: hash },
      orderBy: [{ academicYear: 'asc' }, { semester: 'asc' }],
    }),
  ]);

  const byStaffRecord = await dumpByFacultyMemberIds(
    db,
    facultyMembers.map((m) => m.id),
    hash,
  );

  return {
    facultyMembers,
    staffEducationHistory,
    staffLifecycleDates,
    staffMasterRecords,
    staffProgramAssignments,
    studentProgramRecords,
    ...byStaffRecord,
  };
}

/**
 * The user's staff records: every record (active or not) carrying the user's
 * HR employeeId; failing that, the record the /profile page resolves for them
 * (which may be a Thai-name match). `matchedBy` is exported so the operator
 * can check a name match before sending the bundle.
 */
async function staffRecordsForUser(
  db: PrismaClient,
  user: { employeeId: string | null; name: string | null },
  resolveStaff: ResolveStaffForUser | undefined,
): Promise<{ facultyMemberIds: string[]; matchedBy: 'employeeId' | 'profile-resolver' | null }> {
  if (user.employeeId) {
    const rows = await db.facultyMember.findMany({
      where: { employeeId: user.employeeId },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (rows.length > 0) return { facultyMemberIds: rows.map((r) => r.id), matchedBy: 'employeeId' };
  }
  const resolved = resolveStaff ? await resolveStaff(user) : null;
  return resolved
    ? { facultyMemberIds: [resolved], matchedBy: 'profile-resolver' }
    : { facultyMemberIds: [], matchedBy: null };
}

// ── User-keyed dump (covers session-bound personal surfaces) ────────
export async function dumpByUserId(
  db: PrismaClient,
  userId: string,
  resolveStaff?: ResolveStaffForUser,
) {
  const [
    user,
    userScopes,
    auditLogs,
    aiInferences,
    annotations,
    analystConversations,
    analystFeedback,
    councilDecisions,
    decisionApprovers,
    notifications,
    pdfDocumentsUploaded,
    pdfExtractionsReviewed,
    savedCockpitViews,
    scenarios,
    signalSubscriptions,
    userExpertiseNarratives,
    userPublicationsCache,
  ] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.userScope.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    db.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    db.aiInference.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    db.annotation.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    db.analystConversation.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    }),
    db.analystFeedback.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    db.councilDecision.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    db.decisionApprover.findMany({
      where: { userId },
      // DecisionApprover has no addedAt (the pre-v2 script sorted on it and
      // threw on every --user-id run); approvedAt, then id for stability.
      orderBy: [{ approvedAt: 'asc' }, { id: 'asc' }],
    }),
    db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    db.pdfDocument.findMany({
      where: { uploadedByUserId: userId },
      orderBy: { createdAt: 'asc' },
    }),
    db.pdfExtraction.findMany({
      where: { reviewedByUserId: userId },
      orderBy: { reviewedAt: 'asc' },
    }),
    db.savedCockpitView.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    db.scenario.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
    db.signalSubscription.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
    }),
    db.userExpertiseNarrative.findMany({
      where: { userId },
      orderBy: { generatedAt: 'asc' },
    }),
    // Legacy: nothing reads or writes this table since the staff-profile
    // refactor (the cache moved to staff_publications_cache), but its rows
    // are still held until the table is dropped, so a DSAR must include
    // them. Remove this line in the same commit as the drop migration —
    // the model's removal makes this call throw at runtime.
    db.userPublicationsCache.findUnique({ where: { userId } }),
  ]);

  const staffRecord = user
    ? await staffRecordsForUser(db, user, resolveStaff)
    : { facultyMemberIds: [], matchedBy: null };
  const byStaffRecord = await dumpByFacultyMemberIds(db, staffRecord.facultyMemberIds);

  return {
    user,
    userScopes,
    auditLogs,
    aiInferences,
    annotations,
    analystConversations,
    analystFeedback,
    councilDecisions,
    decisionApprovers,
    notifications,
    pdfDocumentsUploaded,
    pdfExtractionsReviewed,
    savedCockpitViews,
    scenarios,
    signalSubscriptions,
    userExpertiseNarratives,
    userPublicationsCache,
    staffRecord,
    ...byStaffRecord,
  };
}
