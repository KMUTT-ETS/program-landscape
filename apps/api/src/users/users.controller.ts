import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { prisma } from '@kku/db';
import {
  isAdminGrade,
  ROLE_PERMISSIONS,
  UpdatePublicProfileBodySchema,
  UpdateThemeBodySchema,
  type MeResponse,
  type PublicProfileState,
  type SessionUser,
  type UpdatePublicProfileBody,
  type UpdateThemeBody,
} from '@kku/shared';
import {
  AuditLog,
  AuthSession,
  ZodValidationPipe,
} from '../common';

// Generate a 12-char base64url slug. ~72 bits of entropy — collision
// probability is negligible at KKU's user-base scale (≤20k accounts).
// Uses `-` and `_` (URL-safe alphabet); no `+` or `/`.
function generateSlug(): string {
  return randomBytes(9).toString('base64url');
}

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
        // Roles with read-all visibility: admin-grade + UNIVERSITY_USER.
        // FACULTY_USER + PROGRAM_USER are spatially scoped — they only
        // see their own faculty/department in detail.
        allFacultiesRead:
          isAdminGrade(user.role) || user.role === 'UNIVERSITY_USER',
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

  // ────────────────────────────────────────────────────────────────────────
  // Public profile sharing — toggle on/off + indexability + regenerate slug
  // ────────────────────────────────────────────────────────────────────────

  @Get('/public-profile')
  async getPublicProfile(@AuthSession() user: SessionUser): Promise<PublicProfileState> {
    const row = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        publicProfileEnabled: true,
        publicProfileSlug: true,
        publicProfileIndexable: true,
        publicProfileUpdatedAt: true,
      },
    });
    return {
      enabled: row?.publicProfileEnabled ?? false,
      slug: row?.publicProfileSlug ?? null,
      indexable: row?.publicProfileIndexable ?? true,
      updatedAt: row?.publicProfileUpdatedAt?.toISOString() ?? null,
    };
  }

  @Patch('/public-profile')
  @AuditLog({ action: 'update_public_profile', entityType: 'user' })
  async updatePublicProfile(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(UpdatePublicProfileBodySchema))
    body: UpdatePublicProfileBody,
  ): Promise<PublicProfileState> {
    // Generate the slug on first enable. Slug PERSISTS across enable→
    // disable→re-enable so previously-shared QR codes / printed cards
    // keep working when the user re-enables. Burning the slug is an
    // explicit `POST /public-profile/regenerate-slug` call.
    let slug: string | null = null;
    if (body.enabled === true) {
      const existing = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { publicProfileSlug: true },
      });
      slug = existing?.publicProfileSlug ?? generateSlug();
    }

    const updated = await prisma.user.update({
      where: { id: user.userId },
      data: {
        ...(body.enabled !== undefined ? { publicProfileEnabled: body.enabled } : {}),
        ...(body.indexable !== undefined ? { publicProfileIndexable: body.indexable } : {}),
        ...(slug ? { publicProfileSlug: slug } : {}),
        publicProfileUpdatedAt: new Date(),
      },
      select: {
        publicProfileEnabled: true,
        publicProfileSlug: true,
        publicProfileIndexable: true,
        publicProfileUpdatedAt: true,
      },
    });
    return {
      enabled: updated.publicProfileEnabled,
      slug: updated.publicProfileSlug,
      indexable: updated.publicProfileIndexable,
      updatedAt: updated.publicProfileUpdatedAt?.toISOString() ?? null,
    };
  }

  @Post('/public-profile/regenerate-slug')
  @AuditLog({ action: 'regenerate_public_profile_slug', entityType: 'user' })
  async regenerateSlug(
    @AuthSession() user: SessionUser,
  ): Promise<PublicProfileState> {
    const slug = generateSlug();
    const updated = await prisma.user.update({
      where: { id: user.userId },
      data: {
        publicProfileSlug: slug,
        publicProfileUpdatedAt: new Date(),
      },
      select: {
        publicProfileEnabled: true,
        publicProfileSlug: true,
        publicProfileIndexable: true,
        publicProfileUpdatedAt: true,
      },
    });
    return {
      enabled: updated.publicProfileEnabled,
      slug: updated.publicProfileSlug,
      indexable: updated.publicProfileIndexable,
      updatedAt: updated.publicProfileUpdatedAt?.toISOString() ?? null,
    };
  }
}
