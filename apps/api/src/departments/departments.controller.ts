import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { prisma } from '@kku/db';
import { Authorized, Provenance } from '../common';

@Controller('/departments')
export class DepartmentsController {
  @Get(':id')
  @Authorized('departments:read:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async getOne(@Param('id') id: string) {
    const department = await prisma.department.findUnique({ where: { id } });
    if (!department) throw new NotFoundException();
    return department;
  }

  @Get(':id/programs')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async programs(@Param('id') id: string) {
    return prisma.program.findMany({
      where: { departmentId: id },
      orderBy: { code: 'asc' },
    });
  }
}
