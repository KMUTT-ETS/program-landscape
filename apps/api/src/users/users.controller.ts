import { Body, Controller, Get, Patch } from '@nestjs/common';
import { prisma } from '@kku/db';
import {
  ROLE_PERMISSIONS,
  UpdateThemeBodySchema,
  type MeResponse,
  type SessionUser,
  type UpdateThemeBody,
} from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  ZodValidationPipe,
} from '../common';

@Controller('/me')
export class UsersController {
  @Get()
  async me(@AuthSession() user: SessionUser): Promise<MeResponse> {
    return {
      id: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
      themePreference: user.themePreference,
      permissions: Array.from(ROLE_PERMISSIONS[user.role]),
      scopeAccess: {
        universityRead: true,
        allFacultiesRead:
          user.role === 'ADMIN' ||
          user.role === 'COUNCIL' ||
          user.role === 'EXECUTIVE' ||
          user.role === 'ANALYST' ||
          user.role === 'VIEWER',
        ownFacultyId: user.facultyId,
        ownDepartmentId: user.departmentId,
      },
    };
  }

  @Patch('/theme')
  @AuditLog({ action: 'update_theme', entityType: 'user' })
  async updateTheme(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(UpdateThemeBodySchema)) body: UpdateThemeBody,
  ) {
    const updated = await prisma.user.update({
      where: { id: user.userId },
      data: { themePreference: body.themePreference },
      select: {
        id: true,
        themePreference: true,
      },
    });
    return { id: updated.id, themePreference: updated.themePreference };
  }
}
