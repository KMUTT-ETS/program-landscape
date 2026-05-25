import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import { AuthSession, Authorized, Provenance, seesAllScopes } from '../common';

@Controller('/departments')
export class DepartmentsController {
  // GET /departments — list endpoint. Admin pages (/admin/programs/new,
  // /admin/programs/from-pdf, /admin/programs/[id]) call this to
  // populate the department-picker dropdown. Was missing — those pages
  // 404'd here and fell back to an empty array via .catch, leaving the
  // dropdown unpopulated.
  @Get()
  @Authorized('departments:read:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async list(@AuthSession() user: SessionUser) {
    // Scoped users see only their own faculty's departments; admins
    // see all. Same posture as the by-id endpoint below — listing
    // other faculties' org tree is a discovery vector.
    const where = seesAllScopes(user.role)
      ? {}
      : { facultyId: user.facultyId ?? '__none__' };
    return prisma.department.findMany({
      where,
      select: { id: true, code: true, nameEn: true, nameTh: true, facultyId: true },
      orderBy: [{ facultyId: 'asc' }, { code: 'asc' }],
    });
  }

  @Get(':id')
  @Authorized('departments:read:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async getOne(@AuthSession() user: SessionUser, @Param('id') id: string) {
    const department = await prisma.department.findUnique({ where: { id } });
    if (!department) throw new NotFoundException();
    // FACULTY_USER + PROGRAM_USER may only see departments inside
    // their own faculty. Surfacing other faculties' org tree is a
    // discovery vector even if the metadata itself is benign.
    if (!seesAllScopes(user.role) && department.facultyId !== user.facultyId) {
      throw new ForbiddenException(
        'This department is outside the faculty assigned to your account.',
      );
    }
    return department;
  }

  @Get(':id/programs')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async programs(@AuthSession() user: SessionUser, @Param('id') id: string) {
    if (!seesAllScopes(user.role)) {
      const dept = await prisma.department.findUnique({
        where: { id },
        select: { facultyId: true },
      });
      if (!dept) throw new NotFoundException();
      if (dept.facultyId !== user.facultyId) {
        throw new ForbiddenException(
          'This department is outside the faculty assigned to your account.',
        );
      }
      // PROGRAM_USER: narrow further to their single program.
      if (user.role === 'PROGRAM_USER') {
        if (!user.programId) return [];
        return prisma.program.findMany({
          where: { id: user.programId, departmentId: id },
          orderBy: { code: 'asc' },
        });
      }
    }
    return prisma.program.findMany({
      where: { departmentId: id },
      orderBy: { code: 'asc' },
    });
  }
}
