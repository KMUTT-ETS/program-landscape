import { Injectable } from '@nestjs/common';
import { prisma, IS_CANONICAL_PROGRAM, withCanonical } from '@kku/db';
import type { Prisma, PrismaClient } from '@kku/db';
import {
  ApiError,
  can,
  type SessionUser,
  type CreateProgramInput,
  type PatchProgramInput,
  type AdminProgramListQuery,
  type AttachProgramDocumentInput,
  type PatchProgramDocumentInput,
  type ApplyExtractionInput,
  type CheckCollisionInput,
  type CollisionMatch,
  type CollisionReport,
} from '@kku/shared';
import { AiJobsQueueService, type ProgramPipelinePhase } from '../ai-jobs/ai-jobs-queue.service';

// ─────────────────────────────────────────────────────────────────────────
// ProgramsService — admin CRUD + curriculum-PDF attachment.
//
// Role gating: every mutation flows through assertCanManage(), which honors
// programs:manage:all (ANALYST/ADMIN, any program) and
// programs:manage:own_faculty (DEAN/DEPT_HEAD, only programs in their own
// faculty). The controller holds the broadest gate (@Authorized manage:all)
// so ANALYST/ADMIN don't need an extra round-trip; DEAN/DEPT_HEAD go
// through the scope-aware branch here.
// ─────────────────────────────────────────────────────────────────────────

type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class ProgramsService {
  constructor(private readonly aiJobs: AiJobsQueueService) {}

  // ───────────────────────────────────────────────────────────────────────
  // Authorization helpers
  // ───────────────────────────────────────────────────────────────────────

  private assertCanManage(
    user: SessionUser,
    programFacultyId: string,
  ): void {
    if (can(user, 'programs:manage:all')) return;
    if (
      can(user, 'programs:manage:own_faculty', {
        level: 'faculty',
        id: programFacultyId,
      })
    ) {
      return;
    }
    throw new ApiError(
      'FORBIDDEN',
      'insufficient permission to manage this program',
    );
  }

  private assertCanCreate(
    user: SessionUser,
    facultyId: string,
  ): void {
    if (can(user, 'programs:manage:all')) return;
    if (
      can(user, 'programs:manage:own_faculty', {
        level: 'faculty',
        id: facultyId,
      })
    ) {
      return;
    }
    throw new ApiError(
      'FORBIDDEN',
      'insufficient permission to create a program in this faculty',
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // List (admin) — richer than the read-only ProgramsController list.
  // ───────────────────────────────────────────────────────────────────────

  async list(q: AdminProgramListQuery) {
    const where: Prisma.ProgramWhereInput = {};
    if (q.facultyId) where.facultyId = q.facultyId;
    if (q.departmentId) where.departmentId = q.departmentId;
    if (q.level) where.level = q.level;
    if (q.status) where.status = q.status;
    if (q.q) {
      where.OR = [
        { code: { contains: q.q, mode: 'insensitive' } },
        { nameTh: { contains: q.q } },
        { nameEn: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    if (q.hasCurrentDocument !== undefined) {
      where.documents = q.hasCurrentDocument
        ? { some: { isCurrent: true } }
        : { none: { isCurrent: true } };
    }

    // Admin program list = curriculum-pipeline workbench → restrict to
    // the canonical 297. Legacy mock-seed rows still exist for staff /
    // education joins but must not show in the pipeline view.
    const canonicalWhere = withCanonical(where);

    const [rows, total] = await prisma.$transaction([
      prisma.program.findMany({
        where: canonicalWhere,
        orderBy: [{ code: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          faculty: { select: { id: true, code: true, nameEn: true, nameTh: true } },
          department: { select: { id: true, code: true, nameEn: true, nameTh: true } },
          documents: {
            where: { isCurrent: true },
            select: {
              id: true,
              role: true,
              curriculumYearBE: true,
              pdfDocument: {
                select: {
                  id: true,
                  originalFilename: true,
                  processingStatus: true,
                },
              },
            },
          },
          _count: { select: { documents: true } },
        },
      }),
      prisma.program.count({ where: canonicalWhere }),
    ]);

    // Annotate each row with "has pending extraction" for the UI badge.
    const pdfIds = rows.flatMap((r) => r.documents.map((d) => d.pdfDocument.id));
    const pending = pdfIds.length
      ? await prisma.pdfExtraction.findMany({
          where: {
            pdfDocumentId: { in: pdfIds },
            extractionType: 'CURRICULUM_SPEC',
            reviewStatus: { in: ['PENDING_REVIEW', 'AUTO_APPROVED'] },
          },
          select: { id: true, pdfDocumentId: true, reviewStatus: true },
        })
      : [];
    const pendingByPdf = new Map<string, (typeof pending)[number][]>();
    for (const p of pending) {
      const arr = pendingByPdf.get(p.pdfDocumentId) ?? [];
      arr.push(p);
      pendingByPdf.set(p.pdfDocumentId, arr);
    }
    const annotated = rows.map((r) => {
      const currentPdfIds = r.documents.map((d) => d.pdfDocument.id);
      const pendingForRow = currentPdfIds.flatMap((id) => pendingByPdf.get(id) ?? []);
      return { ...r, pendingExtractions: pendingForRow };
    });
    // Optional post-filter — rare path; keeps the query simple.
    const filtered = q.hasPendingExtraction
      ? annotated.filter((r) => r.pendingExtractions.length > 0)
      : annotated;

    return {
      data: filtered,
      meta: {
        pagination: { page: q.page, pageSize: q.pageSize, total },
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Detail
  // ───────────────────────────────────────────────────────────────────────

  async getOne(id: string) {
    const row = await prisma.program.findUnique({
      where: { id },
      include: {
        faculty: true,
        department: true,
        documents: {
          orderBy: [{ isCurrent: 'desc' }, { attachedAt: 'desc' }],
          include: {
            pdfDocument: {
              include: {
                extractions: {
                  where: { extractionType: 'CURRICULUM_SPEC' },
                  orderBy: { createdAt: 'desc' },
                  select: {
                    id: true,
                    reviewStatus: true,
                    confidence: true,
                    methodVersion: true,
                    createdAt: true,
                    reviewedAt: true,
                  },
                },
              },
            },
            attachedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!row) throw new ApiError('NOT_FOUND', 'program not found');
    return row;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Collision check — dry-run; used by the create-from-PDF wizard to warn
  // before commit. HARD = unique-constraint-level (code). SOFT = "probably
  // a duplicate" (same nameTh/nameEn at same faculty + level, same
  // degree + department + level).
  // ───────────────────────────────────────────────────────────────────────

  async checkCollision(input: CheckCollisionInput): Promise<CollisionReport> {
    const clauses: Array<Record<string, unknown>> = [];
    if (input.code) clauses.push({ code: { equals: input.code, mode: 'insensitive' } });
    if (input.nameTh && input.facultyId && input.level) {
      clauses.push({
        facultyId: input.facultyId,
        level: input.level,
        nameTh: input.nameTh.trim(),
      });
    }
    if (input.nameEn && input.facultyId && input.level) {
      clauses.push({
        facultyId: input.facultyId,
        level: input.level,
        nameEn: { equals: input.nameEn.trim(), mode: 'insensitive' },
      });
    }
    if (input.departmentId && input.level) {
      clauses.push({
        departmentId: input.departmentId,
        level: input.level,
      });
    }
    if (clauses.length === 0) {
      return { hasHard: false, hasSoft: false, matches: [] };
    }

    const rows = await prisma.program.findMany({
      where: { OR: clauses as Prisma.ProgramWhereInput[] },
      select: {
        id: true,
        code: true,
        nameTh: true,
        nameEn: true,
        facultyId: true,
        departmentId: true,
        level: true,
        status: true,
      },
      take: 20,
    });

    const matches: CollisionMatch[] = rows.map((r) => {
      const reasons: CollisionMatch['reasons'] = [];
      if (input.code && r.code.toLowerCase() === input.code.toLowerCase()) {
        reasons.push('same_code');
      }
      if (
        input.nameTh &&
        input.facultyId &&
        input.level &&
        r.facultyId === input.facultyId &&
        r.level === input.level &&
        r.nameTh.trim() === input.nameTh.trim()
      ) {
        reasons.push('same_name_th');
      }
      if (
        input.nameEn &&
        input.facultyId &&
        input.level &&
        r.facultyId === input.facultyId &&
        r.level === input.level &&
        r.nameEn.trim().toLowerCase() === input.nameEn.trim().toLowerCase()
      ) {
        reasons.push('same_name_en');
      }
      if (
        input.departmentId &&
        input.level &&
        r.departmentId === input.departmentId &&
        r.level === input.level
      ) {
        reasons.push('same_degree_same_department');
      }
      return { ...r, reasons };
    });

    const hasHard = matches.some((m) => m.reasons.includes('same_code'));
    const hasSoft = matches.some((m) =>
      m.reasons.some((r) => r !== 'same_code'),
    );
    return { hasHard, hasSoft, matches };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Create — minimal shell; header fields filled via extraction or patch.
  // When input.attachPdfId is set, the PDF is attached atomically (role=
  // CURRENT_CURRICULUM). When applyExtractionId is also set, the
  // CURRICULUM_SPEC payload is materialized onto the new row.
  //
  // The `force` flag skips the SOFT collision guard; the HARD guard (unique
  // code) is always enforced (the DB unique constraint backstops it too).
  // ───────────────────────────────────────────────────────────────────────

  async create(user: SessionUser, input: CreateProgramInput) {
    this.assertCanCreate(user, input.facultyId);

    const report = await this.checkCollision({
      code: input.code,
      nameTh: input.nameTh,
      nameEn: input.nameEn,
      facultyId: input.facultyId,
      departmentId: input.departmentId ?? null,
      level: input.level,
    });
    if (report.hasHard) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `program code "${input.code}" is already in use`,
        { field: 'code', collisions: report.matches },
      );
    }
    if (report.hasSoft && !input.force) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'a similar program already exists; set force=true to create anyway',
        { field: 'name', collisions: report.matches, hasSoft: true },
      );
    }

    // Pre-validate referenced PDF + extraction exist; fail before the tx so
    // the admin gets a crisp error instead of a partial-success rollback.
    if (input.attachPdfId) {
      const pdf = await prisma.pdfDocument.findUnique({
        where: { id: input.attachPdfId },
        select: { id: true },
      });
      if (!pdf) throw new ApiError('NOT_FOUND', 'attachPdfId not found');
    }
    // When the admin ticks "apply extraction", we materialize the FULL
    // heuristic-v1 payload (degree names, majors, plans, approvals,
    // careers) onto the new Program row. The input schema doesn't carry
    // these so they come straight from the extraction payload.
    type ExtractionPayload = Prisma.ProgramUncheckedCreateInput;
    let extractionPayload: ExtractionPayload | null = null;
    if (input.applyExtractionId) {
      if (!input.attachPdfId) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'applyExtractionId requires attachPdfId to be set',
        );
      }
      const extraction = await prisma.pdfExtraction.findUnique({
        where: { id: input.applyExtractionId },
        select: {
          id: true,
          pdfDocumentId: true,
          extractionType: true,
          payloadJson: true,
        },
      });
      if (!extraction) {
        throw new ApiError('NOT_FOUND', 'applyExtractionId not found');
      }
      if (extraction.pdfDocumentId !== input.attachPdfId) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'applyExtractionId must belong to attachPdfId',
        );
      }
      if (extraction.extractionType !== 'CURRICULUM_SPEC') {
        throw new ApiError(
          'VALIDATION_FAILED',
          'only CURRICULUM_SPEC extractions can be applied',
        );
      }
      const p = extraction.payloadJson as {
        totalCredits?: number;
        durationYears?: number;
        curriculumYear?: number;
        degreeNameTh?: string;
        degreeNameEn?: string;
        degreeAbbrTh?: string;
        degreeAbbrEn?: string;
        majors?: string[];
        programPlans?: string[];
        language?: 'TH' | 'EN' | 'MIXED';
        admissionScope?: 'TH_ONLY' | 'TH_AND_INTL' | 'INTL_ONLY';
        isRevision?: boolean;
        previousCurriculumYearBE?: number;
        openingYear?: number;
        openingSemester?: number;
        approvalHistory?: unknown;
        careersTh?: string[];
      };
      const curriculumYearBE = p.curriculumYear
        ? p.curriculumYear > 2400
          ? p.curriculumYear
          : p.curriculumYear + 543
        : undefined;
      extractionPayload = {
        // Minimal required pieces of ProgramUncheckedCreateInput come from
        // the outer `input` — here we only set the extracted header fields.
        code: '',
        nameTh: '',
        nameEn: '',
        facultyId: '',
        level: 'BACHELOR',
        ...(p.totalCredits !== undefined ? { totalCredits: p.totalCredits } : {}),
        ...(p.durationYears !== undefined ? { durationYears: p.durationYears } : {}),
        ...(curriculumYearBE !== undefined ? { curriculumYearBE } : {}),
        ...(p.degreeNameTh ? { degreeNameTh: p.degreeNameTh } : {}),
        ...(p.degreeNameEn ? { degreeNameEn: p.degreeNameEn } : {}),
        ...(p.degreeAbbrTh ? { degreeAbbrTh: p.degreeAbbrTh } : {}),
        ...(p.degreeAbbrEn ? { degreeAbbrEn: p.degreeAbbrEn } : {}),
        ...(p.majors && p.majors.length ? { majors: p.majors } : {}),
        ...(p.programPlans && p.programPlans.length
          ? { programPlans: p.programPlans }
          : {}),
        ...(p.language ? { language: p.language } : {}),
        ...(p.admissionScope ? { admissionScope: p.admissionScope } : {}),
        ...(p.isRevision !== undefined ? { isRevision: p.isRevision } : {}),
        ...(p.previousCurriculumYearBE
          ? { previousCurriculumYearBE: p.previousCurriculumYearBE }
          : {}),
        ...(p.openingYear ? { openingYear: p.openingYear } : {}),
        ...(p.openingSemester ? { openingSemester: p.openingSemester } : {}),
        ...(p.approvalHistory
          ? { approvalHistoryJson: p.approvalHistory as Prisma.InputJsonValue }
          : {}),
        ...(p.careersTh && p.careersTh.length
          ? { careersThJson: p.careersTh as unknown as Prisma.InputJsonValue }
          : {}),
      };
    }

    // Compose create-input: admin form values are authoritative for
    // code/names/faculty/dept/level/yearEst; the extraction supplies
    // every other header field when available.
    const {
      code: _ignore_code,
      nameTh: _ignore_nth,
      nameEn: _ignore_nen,
      facultyId: _ignore_fac,
      level: _ignore_level,
      ...extractionHeader
    } = extractionPayload ?? ({} as Prisma.ProgramUncheckedCreateInput);
    void _ignore_code;
    void _ignore_nth;
    void _ignore_nen;
    void _ignore_fac;
    void _ignore_level;

    return prisma.$transaction(async (tx) => {
      const created = await tx.program.create({
        data: {
          code: input.code,
          nameTh: input.nameTh,
          nameEn: input.nameEn,
          facultyId: input.facultyId,
          departmentId: input.departmentId ?? null,
          level: input.level,
          yearEstablished: input.yearEstablished ?? null,
          ...extractionHeader,
        },
      });

      if (input.attachPdfId) {
        await tx.programDocument.create({
          data: {
            programId: created.id,
            pdfDocumentId: input.attachPdfId,
            role: 'CURRENT_CURRICULUM',
            isCurrent: true,
            curriculumYearBE:
              (extractionPayload?.curriculumYearBE as number | undefined) ?? null,
            notes: input.applyExtractionId
              ? 'attached via create-from-PDF with extraction applied'
              : 'attached via create-from-PDF',
            attachedById: user.userId,
          },
        });
        if (input.applyExtractionId) {
          await tx.pdfExtraction.update({
            where: { id: input.applyExtractionId },
            data: {
              targetEntityType: 'Program',
              targetEntityId: created.id,
              reviewStatus: 'APPROVED',
              reviewedByUserId: user.userId,
              reviewedAt: new Date(),
            },
          });
        }
      }

      return created;
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Patch
  // ───────────────────────────────────────────────────────────────────────

  async patch(user: SessionUser, id: string, input: PatchProgramInput) {
    const existing = await prisma.program.findUnique({
      where: { id },
      select: { id: true, facultyId: true, code: true },
    });
    if (!existing) throw new ApiError('NOT_FOUND', 'program not found');
    this.assertCanManage(user, existing.facultyId);

    if (input.code && input.code !== existing.code) {
      const clash = await prisma.program.findUnique({
        where: { code: input.code },
        select: { id: true },
      });
      if (clash && clash.id !== id) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `program code "${input.code}" is already in use`,
          { field: 'code' },
        );
      }
    }
    if (input.facultyId && input.facultyId !== existing.facultyId) {
      // Reassigning to a different faculty must be authorized under the new
      // faculty too — prevents a dean moving a program into another faculty.
      this.assertCanManage(user, input.facultyId);
    }

    const data: Prisma.ProgramUpdateInput = {};
    if (input.code !== undefined) data.code = input.code;
    if (input.nameTh !== undefined) data.nameTh = input.nameTh;
    if (input.nameEn !== undefined) data.nameEn = input.nameEn;
    if (input.facultyId !== undefined) data.faculty = { connect: { id: input.facultyId } };
    if (input.departmentId !== undefined) {
      data.department =
        input.departmentId === null
          ? { disconnect: true }
          : { connect: { id: input.departmentId } };
    }
    if (input.level !== undefined) data.level = input.level;
    if (input.status !== undefined) data.status = input.status;
    if (input.yearEstablished !== undefined) data.yearEstablished = input.yearEstablished;

    if (input.degreeNameTh !== undefined) data.degreeNameTh = input.degreeNameTh;
    if (input.degreeNameEn !== undefined) data.degreeNameEn = input.degreeNameEn;
    if (input.degreeAbbrTh !== undefined) data.degreeAbbrTh = input.degreeAbbrTh;
    if (input.degreeAbbrEn !== undefined) data.degreeAbbrEn = input.degreeAbbrEn;
    if (input.majors !== undefined) data.majors = input.majors;
    if (input.totalCredits !== undefined) data.totalCredits = input.totalCredits;
    if (input.durationYears !== undefined) data.durationYears = input.durationYears;
    if (input.programPlans !== undefined) data.programPlans = input.programPlans;
    if (input.language !== undefined) data.language = input.language;
    if (input.admissionScope !== undefined) data.admissionScope = input.admissionScope;
    if (input.careersTh !== undefined) {
      data.careersThJson = input.careersTh as Prisma.InputJsonValue;
    }
    if (input.openingYear !== undefined) data.openingYear = input.openingYear;
    if (input.openingSemester !== undefined) data.openingSemester = input.openingSemester;
    if (input.curriculumYearBE !== undefined) data.curriculumYearBE = input.curriculumYearBE;
    if (input.isRevision !== undefined) data.isRevision = input.isRevision;
    if (input.previousCurriculumYearBE !== undefined) {
      data.previousCurriculumYearBE = input.previousCurriculumYearBE;
    }
    if (input.approvalHistory !== undefined) {
      data.approvalHistoryJson = input.approvalHistory as Prisma.InputJsonValue;
    }

    return prisma.program.update({ where: { id }, data });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Soft delete — always flip to SUNSET; never hard-delete a program
  // (audit + strategic-record contract with Council).
  // ───────────────────────────────────────────────────────────────────────

  async sunset(user: SessionUser, id: string) {
    const existing = await prisma.program.findUnique({
      where: { id },
      select: { id: true, facultyId: true, status: true },
    });
    if (!existing) throw new ApiError('NOT_FOUND', 'program not found');
    this.assertCanManage(user, existing.facultyId);
    if (existing.status === 'SUNSET') return existing;
    return prisma.program.update({
      where: { id },
      data: { status: 'SUNSET' },
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Documents — attach, promote, detach
  // ───────────────────────────────────────────────────────────────────────

  async attachDocument(
    user: SessionUser,
    programId: string,
    input: AttachProgramDocumentInput,
  ) {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: { id: true, facultyId: true },
    });
    if (!program) throw new ApiError('NOT_FOUND', 'program not found');
    this.assertCanManage(user, program.facultyId);

    const pdf = await prisma.pdfDocument.findUnique({
      where: { id: input.pdfDocumentId },
      select: { id: true, sourceCategory: true },
    });
    if (!pdf) throw new ApiError('NOT_FOUND', 'pdf document not found');

    return prisma.$transaction(async (tx) => {
      const makeCurrent = input.role === 'CURRENT_CURRICULUM' && input.promoteToCurrent !== false;
      if (makeCurrent) {
        await this.demotePriorCurrent(tx, programId);
      }
      return tx.programDocument.upsert({
        where: {
          programId_pdfDocumentId: {
            programId,
            pdfDocumentId: input.pdfDocumentId,
          },
        },
        create: {
          programId,
          pdfDocumentId: input.pdfDocumentId,
          role: input.role,
          curriculumYearBE: input.curriculumYearBE ?? null,
          isCurrent: makeCurrent,
          notes: input.notes ?? null,
          attachedById: user.userId,
        },
        update: {
          role: input.role,
          curriculumYearBE: input.curriculumYearBE ?? null,
          isCurrent: makeCurrent ? true : undefined,
          notes: input.notes ?? undefined,
        },
        include: {
          pdfDocument: true,
          attachedBy: { select: { id: true, name: true, email: true } },
        },
      });
    });
  }

  async promoteDocument(
    user: SessionUser,
    programId: string,
    documentId: string,
  ) {
    const doc = await prisma.programDocument.findUnique({
      where: { id: documentId },
      include: { program: { select: { id: true, facultyId: true } } },
    });
    if (!doc || doc.programId !== programId) {
      throw new ApiError('NOT_FOUND', 'program document not found');
    }
    this.assertCanManage(user, doc.program.facultyId);

    return prisma.$transaction(async (tx) => {
      await this.demotePriorCurrent(tx, programId);
      return tx.programDocument.update({
        where: { id: documentId },
        data: { role: 'CURRENT_CURRICULUM', isCurrent: true },
      });
    });
  }

  async patchDocument(
    user: SessionUser,
    programId: string,
    documentId: string,
    input: PatchProgramDocumentInput,
  ) {
    const doc = await prisma.programDocument.findUnique({
      where: { id: documentId },
      include: { program: { select: { id: true, facultyId: true } } },
    });
    if (!doc || doc.programId !== programId) {
      throw new ApiError('NOT_FOUND', 'program document not found');
    }
    this.assertCanManage(user, doc.program.facultyId);
    return prisma.programDocument.update({
      where: { id: documentId },
      data: {
        role: input.role ?? undefined,
        curriculumYearBE: input.curriculumYearBE ?? undefined,
        notes: input.notes ?? undefined,
      },
    });
  }

  async detachDocument(
    user: SessionUser,
    programId: string,
    documentId: string,
  ) {
    const doc = await prisma.programDocument.findUnique({
      where: { id: documentId },
      include: { program: { select: { id: true, facultyId: true } } },
    });
    if (!doc || doc.programId !== programId) {
      throw new ApiError('NOT_FOUND', 'program document not found');
    }
    this.assertCanManage(user, doc.program.facultyId);
    await prisma.programDocument.delete({ where: { id: documentId } });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Apply-extraction — materialize a reviewed CURRICULUM_SPEC payload onto
  // the Program row. Admin reviews the extraction, optionally edits fields,
  // then clicks Apply; this writes the partial-update + attaches the PDF.
  // ───────────────────────────────────────────────────────────────────────

  async applyExtraction(
    user: SessionUser,
    programId: string,
    extractionId: string,
    input: ApplyExtractionInput,
  ) {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: { id: true, facultyId: true },
    });
    if (!program) throw new ApiError('NOT_FOUND', 'program not found');
    this.assertCanManage(user, program.facultyId);

    const extraction = await prisma.pdfExtraction.findUnique({
      where: { id: extractionId },
      include: { pdfDocument: { select: { id: true, sourceCategory: true } } },
    });
    if (!extraction) throw new ApiError('NOT_FOUND', 'extraction not found');
    if (extraction.extractionType !== 'CURRICULUM_SPEC') {
      throw new ApiError(
        'VALIDATION_FAILED',
        'only CURRICULUM_SPEC extractions can be applied to a program',
      );
    }

    const payload = extraction.payloadJson as {
      programCode?: string;
      programNameTh?: string;
      programNameEn?: string;
      level?: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
      totalCredits?: number;
      durationYears?: number;
      curriculumYear?: number; // BE or CE — normalized below
      degreeNameTh?: string;
      degreeNameEn?: string;
      degreeAbbrTh?: string;
      degreeAbbrEn?: string;
      majors?: string[];
      programPlans?: string[];
      language?: 'TH' | 'EN' | 'MIXED';
      admissionScope?: 'TH_ONLY' | 'TH_AND_INTL' | 'INTL_ONLY';
      isRevision?: boolean;
      previousCurriculumYearBE?: number;
      openingYear?: number;
      openingSemester?: number;
      approvalHistory?: Array<{
        body:
          | 'FACULTY_COMMITTEE'
          | 'UNIVERSITY_SCREENING'
          | 'ACADEMIC_COUNCIL'
          | 'UNIVERSITY_COUNCIL'
          | 'GRADUATE_SCHOOL'
          | 'OTHER';
        meetingNo?: string;
        meetingDate?: string;
      }>;
      careersTh?: string[];
    };

    // Build the patch from the extraction payload. Admin overrides win.
    const programPatch: PatchProgramInput = {
      ...(payload.programNameTh ? { nameTh: payload.programNameTh } : {}),
      ...(payload.programNameEn ? { nameEn: payload.programNameEn } : {}),
      ...(payload.level ? { level: payload.level } : {}),
      ...(payload.totalCredits ? { totalCredits: payload.totalCredits } : {}),
      ...(payload.durationYears ? { durationYears: payload.durationYears } : {}),
      ...(payload.curriculumYear
        ? {
            // Treat values >2400 as BE (heuristic-v1 already emits BE), and
            // smaller values as CE with +543 offset.
            curriculumYearBE:
              payload.curriculumYear > 2400
                ? payload.curriculumYear
                : payload.curriculumYear + 543,
          }
        : {}),
      ...(payload.degreeNameTh ? { degreeNameTh: payload.degreeNameTh } : {}),
      ...(payload.degreeNameEn ? { degreeNameEn: payload.degreeNameEn } : {}),
      ...(payload.degreeAbbrTh ? { degreeAbbrTh: payload.degreeAbbrTh } : {}),
      ...(payload.degreeAbbrEn ? { degreeAbbrEn: payload.degreeAbbrEn } : {}),
      ...(payload.majors && payload.majors.length ? { majors: payload.majors } : {}),
      ...(payload.programPlans && payload.programPlans.length
        ? { programPlans: payload.programPlans }
        : {}),
      ...(payload.language ? { language: payload.language } : {}),
      ...(payload.admissionScope ? { admissionScope: payload.admissionScope } : {}),
      ...(payload.isRevision !== undefined ? { isRevision: payload.isRevision } : {}),
      ...(payload.previousCurriculumYearBE
        ? { previousCurriculumYearBE: payload.previousCurriculumYearBE }
        : {}),
      ...(payload.openingYear ? { openingYear: payload.openingYear } : {}),
      ...(payload.openingSemester ? { openingSemester: payload.openingSemester } : {}),
      ...(payload.approvalHistory && payload.approvalHistory.length
        ? { approvalHistory: payload.approvalHistory }
        : {}),
      ...(payload.careersTh && payload.careersTh.length
        ? { careersTh: payload.careersTh }
        : {}),
      ...input.overrides,
    };

    return prisma.$transaction(async (tx) => {
      // 1. update the Program row
      const updated = await tx.program.update({
        where: { id: programId },
        data: this.mapPatchToPrismaData(programPatch),
      });

      // 2. attach the PDF if requested
      if (input.attachAsCurrent !== false) {
        await this.demotePriorCurrent(tx, programId);
        await tx.programDocument.upsert({
          where: {
            programId_pdfDocumentId: {
              programId,
              pdfDocumentId: extraction.pdfDocumentId,
            },
          },
          create: {
            programId,
            pdfDocumentId: extraction.pdfDocumentId,
            role: 'CURRENT_CURRICULUM',
            curriculumYearBE: programPatch.curriculumYearBE ?? null,
            isCurrent: true,
            attachedById: user.userId,
            notes: 'attached via apply-extraction',
          },
          update: {
            role: 'CURRENT_CURRICULUM',
            isCurrent: true,
          },
        });
      }

      // 3. stamp the extraction as applied (targetEntityId → programId)
      await tx.pdfExtraction.update({
        where: { id: extractionId },
        data: {
          targetEntityType: 'Program',
          targetEntityId: programId,
          reviewStatus:
            extraction.reviewStatus === 'REJECTED'
              ? extraction.reviewStatus
              : 'APPROVED',
          reviewedByUserId: user.userId,
          reviewedAt: new Date(),
        },
      });

      return updated;
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────

  private async demotePriorCurrent(tx: PrismaTx, programId: string): Promise<void> {
    await tx.programDocument.updateMany({
      where: { programId, isCurrent: true },
      data: { isCurrent: false, role: 'PREVIOUS_CURRICULUM' },
    });
  }

  // Mirrors the patch logic in `patch()` for use inside a transaction.
  // Kept separate so transactions don't re-read + re-validate the target row.
  private mapPatchToPrismaData(
    input: PatchProgramInput,
  ): Prisma.ProgramUpdateInput {
    const data: Prisma.ProgramUpdateInput = {};
    if (input.code !== undefined) data.code = input.code;
    if (input.nameTh !== undefined) data.nameTh = input.nameTh;
    if (input.nameEn !== undefined) data.nameEn = input.nameEn;
    if (input.facultyId !== undefined) data.faculty = { connect: { id: input.facultyId } };
    if (input.departmentId !== undefined) {
      data.department =
        input.departmentId === null
          ? { disconnect: true }
          : { connect: { id: input.departmentId } };
    }
    if (input.level !== undefined) data.level = input.level;
    if (input.status !== undefined) data.status = input.status;
    if (input.yearEstablished !== undefined) data.yearEstablished = input.yearEstablished;

    if (input.degreeNameTh !== undefined) data.degreeNameTh = input.degreeNameTh;
    if (input.degreeNameEn !== undefined) data.degreeNameEn = input.degreeNameEn;
    if (input.degreeAbbrTh !== undefined) data.degreeAbbrTh = input.degreeAbbrTh;
    if (input.degreeAbbrEn !== undefined) data.degreeAbbrEn = input.degreeAbbrEn;
    if (input.majors !== undefined) data.majors = input.majors;
    if (input.totalCredits !== undefined) data.totalCredits = input.totalCredits;
    if (input.durationYears !== undefined) data.durationYears = input.durationYears;
    if (input.programPlans !== undefined) data.programPlans = input.programPlans;
    if (input.language !== undefined) data.language = input.language;
    if (input.admissionScope !== undefined) data.admissionScope = input.admissionScope;
    if (input.careersTh !== undefined) {
      data.careersThJson = input.careersTh as Prisma.InputJsonValue;
    }
    if (input.openingYear !== undefined) data.openingYear = input.openingYear;
    if (input.openingSemester !== undefined) data.openingSemester = input.openingSemester;
    if (input.curriculumYearBE !== undefined) data.curriculumYearBE = input.curriculumYearBE;
    if (input.isRevision !== undefined) data.isRevision = input.isRevision;
    if (input.previousCurriculumYearBE !== undefined) {
      data.previousCurriculumYearBE = input.previousCurriculumYearBE;
    }
    if (input.approvalHistory !== undefined) {
      data.approvalHistoryJson = input.approvalHistory as Prisma.InputJsonValue;
    }
    return data;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Curriculum pipeline — surface for /admin/programs/pipeline
  //
  // Buckets a program by its position in the analyse-the-landscape
  // pipeline so the operator can drive the next required action:
  //
  //   missing-pdf    — no CURRENT_CURRICULUM linked yet (need upload)
  //   need-digest    — has PDF, no PROGRAM_DIGEST extraction yet
  //   pending-review — digest is PENDING_REVIEW (analyst sign-off)
  //   approved       — fully analysed (read-only)
  //
  // The bucket query exists on top of the existing list/detail endpoints
  // so the pipeline page is one module on top of stable data — no schema
  // changes required.
  // ─────────────────────────────────────────────────────────────────────

  async getPipelineStats() {
    // One round-trip per scalar; cheap (each is an indexed count).
    // Pipeline only operates on the canonical 297 — extraction rows for
    // legacy/non-canonical Program ids are filtered out before counting
    // so the bucket totals match the curriculum landscape.
    const canonicalIdRows = await prisma.program.findMany({
      where: IS_CANONICAL_PROGRAM,
      select: { id: true },
    });
    const canonicalIds = canonicalIdRows.map((r) => r.id);
    const inCanonical: Prisma.AiExtractionWhereInput =
      canonicalIds.length > 0
        ? { sourceEntityId: { in: canonicalIds } }
        : { sourceEntityId: { in: ['__none__'] } };

    const [
      total,
      withPdfRows,
      digestedRows,
      approvedRows,
      pendingRows,
    ] = await Promise.all([
      prisma.program.count({ where: IS_CANONICAL_PROGRAM }),
      prisma.program.findMany({
        where: {
          ...IS_CANONICAL_PROGRAM,
          documents: { some: { role: 'CURRENT_CURRICULUM', isCurrent: true } },
        },
        select: { id: true },
      }),
      prisma.aiExtraction.findMany({
        where: {
          sourceEntityType: 'program',
          extractionKind: 'PROGRAM_DIGEST',
          ...inCanonical,
        },
        select: { sourceEntityId: true },
        distinct: ['sourceEntityId'],
      }),
      prisma.aiExtraction.count({
        where: {
          sourceEntityType: 'program',
          extractionKind: 'PROGRAM_DIGEST',
          reviewStatus: { in: ['APPROVED', 'AUTO_APPROVED'] },
          ...inCanonical,
        },
      }),
      prisma.aiExtraction.count({
        where: {
          sourceEntityType: 'program',
          extractionKind: 'PROGRAM_DIGEST',
          reviewStatus: 'PENDING_REVIEW',
          ...inCanonical,
        },
      }),
    ]);

    const withPdf = withPdfRows.length;
    const digested = digestedRows.length;
    return {
      programsTotal: total,
      withPdf,
      missingPdf: total - withPdf,
      digested,
      needDigest: withPdf - digested,
      pendingReview: pendingRows,
      approved: approvedRows,
    };
  }

  async listPipelineBucket(
    bucket: 'missing-pdf' | 'need-digest' | 'pending-review' | 'approved',
    opts: { limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);

    if (bucket === 'missing-pdf') {
      const where: Prisma.ProgramWhereInput = {
        ...IS_CANONICAL_PROGRAM,
        documents: { none: { role: 'CURRENT_CURRICULUM', isCurrent: true } },
      };
      const [items, total] = await Promise.all([
        prisma.program.findMany({
          where,
          select: {
            id: true,
            code: true,
            nameTh: true,
            nameEn: true,
            level: true,
            faculty: { select: { id: true, nameEn: true, nameTh: true } },
          },
          orderBy: [{ level: 'asc' }, { code: 'asc' }],
          take: limit,
          skip: offset,
        }),
        prisma.program.count({ where }),
      ]);
      return { items, total, bucket };
    }

    // The remaining three buckets all need the digested-program-id set.
    // Restrict to canonical-program extractions so legacy Program rows
    // can't leak into the pipeline view.
    const canonicalIdRows = await prisma.program.findMany({
      where: IS_CANONICAL_PROGRAM,
      select: { id: true },
    });
    const canonicalIds = canonicalIdRows.map((r) => r.id);
    const allDigested = await prisma.aiExtraction.findMany({
      where: {
        sourceEntityType: 'program',
        extractionKind: 'PROGRAM_DIGEST',
        sourceEntityId: { in: canonicalIds.length > 0 ? canonicalIds : ['__none__'] },
      },
      select: { sourceEntityId: true },
      distinct: ['sourceEntityId'],
    });
    const digestedIds = allDigested.map((r) => r.sourceEntityId);

    if (bucket === 'need-digest') {
      const where: Prisma.ProgramWhereInput = {
        ...IS_CANONICAL_PROGRAM,
        documents: { some: { role: 'CURRENT_CURRICULUM', isCurrent: true } },
        ...(digestedIds.length > 0 ? { id: { notIn: digestedIds } } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.program.findMany({
          where,
          select: {
            id: true,
            code: true,
            nameTh: true,
            nameEn: true,
            level: true,
            faculty: { select: { id: true, nameEn: true, nameTh: true } },
            documents: {
              where: { role: 'CURRENT_CURRICULUM', isCurrent: true },
              select: { pdfDocument: { select: { id: true, originalFilename: true, pageCount: true } } },
              take: 1,
            },
          },
          orderBy: [{ level: 'asc' }, { code: 'asc' }],
          take: limit,
          skip: offset,
        }),
        prisma.program.count({ where }),
      ]);
      return { items, total, bucket };
    }

    // pending-review + approved — surface the latest extraction per program.
    // Both list and count restrict to extractions whose program is in the
    // canonical 297; legacy/non-canonical programs are filtered out so the
    // pipeline buckets match the curriculum landscape.
    const reviewStatusFilter: Prisma.AiExtractionWhereInput['reviewStatus'] =
      bucket === 'pending-review' ? 'PENDING_REVIEW' : { in: ['APPROVED', 'AUTO_APPROVED'] };
    const inCanonical: Prisma.AiExtractionWhereInput =
      canonicalIds.length > 0
        ? { sourceEntityId: { in: canonicalIds } }
        : { sourceEntityId: { in: ['__none__'] } };
    const [extractions, total] = await Promise.all([
      prisma.aiExtraction.findMany({
        where: {
          sourceEntityType: 'program',
          extractionKind: 'PROGRAM_DIGEST',
          reviewStatus: reviewStatusFilter,
          ...inCanonical,
        },
        select: {
          id: true,
          sourceEntityId: true,
          confidence: true,
          createdAt: true,
          reviewStatus: true,
          reviewedAt: true,
          methodVersion: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.aiExtraction.count({
        where: {
          sourceEntityType: 'program',
          extractionKind: 'PROGRAM_DIGEST',
          reviewStatus: reviewStatusFilter,
          ...inCanonical,
        },
      }),
    ]);
    const programIds = extractions.map((e) => e.sourceEntityId);
    const programs = await prisma.program.findMany({
      where: { id: { in: programIds } },
      select: {
        id: true,
        code: true,
        nameTh: true,
        nameEn: true,
        level: true,
        faculty: { select: { id: true, nameEn: true, nameTh: true } },
      },
    });
    const programById = new Map(programs.map((p) => [p.id, p]));
    const items = extractions
      .map((e) => {
        const p = programById.get(e.sourceEntityId);
        if (!p) return null;
        return {
          ...p,
          extraction: {
            id: e.id,
            confidence: e.confidence,
            createdAt: e.createdAt,
            reviewStatus: e.reviewStatus,
            reviewedAt: e.reviewedAt,
            methodVersion: e.methodVersion,
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return { items, total, bucket };
  }

  async enqueueDigest(
    user: SessionUser,
    programId: string,
    opts: { force?: boolean } = {},
  ): Promise<{ jobId: string; programId: string; force: boolean }> {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        facultyId: true,
        documents: {
          where: { role: 'CURRENT_CURRICULUM', isCurrent: true },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!program) throw new ApiError('NOT_FOUND', `program not found: ${programId}`);
    this.assertCanManage(user, program.facultyId);
    if (program.documents.length === 0) {
      throw new ApiError('VALIDATION_FAILED', 'program has no CURRENT_CURRICULUM PDF — link one first');
    }
    if (!opts.force) {
      const existing = await prisma.aiExtraction.findFirst({
        where: {
          sourceEntityType: 'program',
          sourceEntityId: programId,
          extractionKind: 'PROGRAM_DIGEST',
        },
        select: { id: true },
      });
      if (existing) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'PROGRAM_DIGEST already exists for this program — re-run with force=true to overwrite',
        );
      }
    }
    const jobId = await this.aiJobs.enqueue({
      kind: 'RUN_PROGRAM_DIGEST',
      entityId: programId,
      triggeredByUserId: user.userId,
      trigger: 'MANUAL',
    });
    return { jobId, programId, force: !!opts.force };
  }

  async enqueueDigestBulk(
    user: SessionUser,
    opts: { limit?: number } = {},
  ): Promise<{ enqueued: number; jobIds: string[] }> {
    if (!can(user, 'programs:manage:all')) {
      throw new ApiError('FORBIDDEN', 'bulk digest requires programs:manage:all');
    }
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 500);
    const alreadyDigested = await prisma.aiExtraction.findMany({
      where: { sourceEntityType: 'program', extractionKind: 'PROGRAM_DIGEST' },
      select: { sourceEntityId: true },
      distinct: ['sourceEntityId'],
    });
    const excludeIds = alreadyDigested.map((r) => r.sourceEntityId);
    const candidates = await prisma.program.findMany({
      where: {
        documents: { some: { role: 'CURRENT_CURRICULUM', isCurrent: true } },
        ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
      },
      select: { id: true },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
      take: limit,
    });
    const jobIds: string[] = [];
    for (const c of candidates) {
      const jobId = await this.aiJobs.enqueue({
        kind: 'RUN_PROGRAM_DIGEST',
        entityId: c.id,
        triggeredByUserId: user.userId,
        trigger: 'MANUAL',
      });
      jobIds.push(jobId);
    }
    return { enqueued: jobIds.length, jobIds };
  }

  // ─── Full pipeline (phases 1-6) ──────────────────────────────────────
  // Difference from `enqueueDigest`: the digest job runs only Phase 1's
  // PROGRAM_DIGEST extraction. The pipeline job spawns the unified
  // 6-phase script (digest + faculty + skills + approve + careers +
  // demand + Oracle/MSSQL linkage + peer review + strategic narrative).
  //
  // `phases` is an explicit allowlist; absent = all six. Used by the
  // partial-run UI on /admin/data-setup so analysts can rerun e.g.
  // only phase5+phase6 without re-paying for digest/faculty/skills.

  async enqueuePipeline(
    user: SessionUser,
    programId: string,
    opts: {
      phases?: ProgramPipelinePhase[];
      force?: boolean;
    } = {},
  ): Promise<{ jobId: string; programId: string; phases: ProgramPipelinePhase[] | 'all' }> {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: { id: true, facultyId: true, sequenceNoFromSheet: true },
    });
    if (!program) throw new ApiError('NOT_FOUND', `program not found: ${programId}`);
    if (program.sequenceNoFromSheet === null) {
      // The pipeline only runs on the canonical 297. Legacy/non-canonical
      // Program rows are out-of-scope.
      throw new ApiError(
        'VALIDATION_FAILED',
        'pipeline runs on the canonical 297 only; this program is not in the master sheet',
      );
    }
    this.assertCanManage(user, program.facultyId);

    const jobId = await this.aiJobs.enqueue({
      kind: 'RUN_PROGRAM_PIPELINE',
      entityId: programId,
      triggeredByUserId: user.userId,
      trigger: 'MANUAL',
      pipelinePhases: opts.phases,
      pipelineForce: opts.force,
    });
    return {
      jobId,
      programId,
      phases: opts.phases && opts.phases.length > 0 ? opts.phases : 'all',
    };
  }

  async enqueuePipelineBulk(
    user: SessionUser,
    opts: {
      phases?: ProgramPipelinePhase[];
      force?: boolean;
      // Subset of canonical programs to run on. Default = all 297.
      programIds?: string[];
      // Cap on how many to enqueue; defaults to all candidates so the
      // operator gets the full run on one click. Hard ceiling 500.
      limit?: number;
      // When true, skip programs that already have a Phase 6 strategic
      // narrative — same semantic as the CLI's `--resume`.
      resume?: boolean;
    } = {},
  ): Promise<{ enqueued: number; jobIds: string[]; skipped: number }> {
    if (!can(user, 'programs:manage:all')) {
      throw new ApiError('FORBIDDEN', 'bulk pipeline requires programs:manage:all');
    }
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 500);

    const baseWhere: Prisma.ProgramWhereInput = {
      // Canonical 297 only.
      sequenceNoFromSheet: { not: null },
      ...(opts.programIds && opts.programIds.length > 0
        ? { id: { in: opts.programIds } }
        : {}),
    };

    let candidates = await prisma.program.findMany({
      where: baseWhere,
      select: { id: true },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
      take: limit,
    });

    let skipped = 0;
    if (opts.resume) {
      const done = await prisma.programStrategicNarrative.findMany({
        where: { programId: { in: candidates.map((c) => c.id) } },
        select: { programId: true },
      });
      const doneIds = new Set(done.map((d) => d.programId));
      const before = candidates.length;
      candidates = candidates.filter((c) => !doneIds.has(c.id));
      skipped = before - candidates.length;
    }

    const jobIds: string[] = [];
    for (const c of candidates) {
      const jobId = await this.aiJobs.enqueue({
        kind: 'RUN_PROGRAM_PIPELINE',
        entityId: c.id,
        triggeredByUserId: user.userId,
        trigger: 'MANUAL',
        pipelinePhases: opts.phases,
        pipelineForce: opts.force,
      });
      jobIds.push(jobId);
    }
    return { enqueued: jobIds.length, jobIds, skipped };
  }
}
