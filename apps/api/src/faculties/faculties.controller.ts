import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { Prisma, prisma, IS_CANONICAL_PROGRAM } from '@kku/db';
import { Authorized, Provenance } from '../common';

@Controller('/faculties')
export class FacultiesController {
  @Get()
  @Authorized('faculties:read:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async list(
    @Query('hasPrograms') hasProgramsRaw?: string,
  ): Promise<Prisma.FacultyGetPayload<Record<string, never>>[]> {
    // When `?hasPrograms=true`, filter to faculties that have at least
    // one canonical Program (sheet-seeded 297). Used by program-listing
    // pages so the Faculty filter dropdown doesn't show BUs that
    // operationally never appear in the programs table (admin BUs,
    // central offices, language centre, etc.). Other callers (CRUD
    // forms for creating a new program in any faculty) omit the flag
    // and continue to see the full list.
    const where: Prisma.FacultyWhereInput =
      hasProgramsRaw === 'true' || hasProgramsRaw === '1'
        ? { programs: { some: IS_CANONICAL_PROGRAM } }
        : {};
    return prisma.faculty.findMany({
      where,
      orderBy: { code: 'asc' },
    });
  }

  @Get(':id')
  @Authorized('faculties:read:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async getOne(@Param('id') id: string) {
    const faculty = await prisma.faculty.findUnique({ where: { id } });
    if (!faculty) throw new NotFoundException();
    return faculty;
  }

  @Get(':id/departments')
  @Authorized('departments:read:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async departments(@Param('id') id: string) {
    return prisma.department.findMany({
      where: { facultyId: id },
      orderBy: { code: 'asc' },
    });
  }
}
