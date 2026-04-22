import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { prisma } from '@kku/db';
import { Authorized, Provenance } from '../common';

@Controller('/faculties')
export class FacultiesController {
  @Get()
  @Authorized('faculties:read:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async list() {
    return prisma.faculty.findMany({
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
