import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import { AuthSession, Authorized, Provenance, seesAllScopes } from '../common';

@Controller('/departments')
export class DepartmentsController {
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
