import type { NavSection } from '@kku/ui';
// IMPORTANT: client components transit this file (top-bar-breadcrumb).
// Importing runtime values from `@kku/shared` pulls the barrel —
// which re-exports `pdf/hash` (uses `node:crypto`) — and crashes the
// client webpack build. So we only `import type` from @kku/shared here
// and inline any runtime helper we need.
import type { SessionUser } from '@kku/shared';

// Mirrors @kku/shared/auth/roles.ts ADMIN_GRADE_ROLES. Inlined to keep
// this file client-safe — see the import comment above.
function isAdminGrade(role: string | undefined | null): boolean {
  return role === 'SUPER_ADMIN' || role === 'SYSTEM_ADMIN';
}

// Mirrors @kku/shared/auth/roles.ts PROGRAM_AWARE_DASHBOARD_ROLES.
// PROGRAM_USER lands here too because both hubs surface at least one
// program-aware tile (class-offerings, teaching-workload); the hub
// page filters away the faculty-only tiles a PROGRAM_USER can't open.
function canSeeProgramAwareDashboards(role: string | undefined | null): boolean {
  return (
    role === 'SUPER_ADMIN' ||
    role === 'SYSTEM_ADMIN' ||
    role === 'UNIVERSITY_USER' ||
    role === 'FACULTY_USER' ||
    role === 'PROGRAM_USER'
  );
}
import {
  BarChart3,
  BookOpen,
  Building2,
  ClipboardCheck,
  GitCompare,
  GraduationCap,
  Handshake,
  History,
  Home,
  LineChart,
  Microscope,
  PieChart,
  ShieldAlert,
  Sparkles,
  SplitSquareVertical,
  Users,
  Wrench,
} from 'lucide-react';
import { createElement } from 'react';

// Left-nav layout.
//
// 2026-05-10 reorganisation: split the old "Modules" section into
// "Dashboards" (heavy ready-to-read overview surfaces) and "Analysis"
// (ad-hoc / drill-in tools). Home is now a lightweight welcome page;
// the old executive dashboard moved to /dashboards/executive-landscape
// so first-page-after-sign-in renders in <300ms instead of 1-2s.
// Sections: Home → Dashboards → Analysis → Admin → Reference.

const homeSection: NavSection = {
  label: 'Home',
  items: [
    { href: '/', label: 'Home', icon: createElement(Home), moduleKey: 'neutral' },
  ],
};

const dashboardItemsBase = [
  {
    href: '/dashboards/executive-landscape',
    label: 'Executive Landscape',
    icon: createElement(GraduationCap),
    moduleKey: 'neutral' as const,
  },
  { href: '/cockpit', label: 'Portfolio Cockpit', icon: createElement(PieChart), moduleKey: 'cockpit' as const },
];

// Education + Staff dashboards are visible to admin-grade +
// UNIVERSITY_USER + FACULTY_USER. The FACULTY_USER variant is the
// same UI clamped server-side to user.facultyId (filter dropdowns are
// locked to their own faculty). PROGRAM_USER also lands here — the
// hubs surface the program-aware tiles (/education/class-offerings +
// /staff/teaching-workload) and filter away the rest.
const dashboardItemsFacultyAware = [
  {
    href: '/education',
    label: 'Education',
    icon: createElement(GraduationCap),
    moduleKey: 'neutral' as const,
  },
  {
    href: '/staff',
    label: 'Staff',
    icon: createElement(Users),
    moduleKey: 'neutral' as const,
  },
];

// Platform usage — gated on `usage:read:aggregate`, which only the two
// admin grades and UNIVERSITY_USER hold. This file can't call `can()`
// (see the import comment at the top), so the role list is mirrored here;
// the page itself re-checks with the real `can()` before rendering, so a
// drift in this list shows as a missing menu entry, never as access.
const usageItem = {
  href: '/usage',
  label: 'Platform usage',
  icon: createElement(BarChart3),
  moduleKey: 'neutral' as const,
};

function canSeeUsage(role: string | undefined | null): boolean {
  return isAdminGrade(role) || role === 'UNIVERSITY_USER';
}

function dashboardsSectionFor(user: SessionUser | undefined): NavSection {
  // Use effectiveRole when available — a user whose primary role is
  // PROGRAM_USER but who has a UserScope grant of UNIVERSITY_USER or
  // FACULTY_USER should see Education + Staff in the nav. Falls back
  // to `role` for older JWTs minted before effectiveRole landed.
  const role = user?.effectiveRole ?? user?.role;
  return {
    label: 'Dashboards',
    items: [
      ...(canSeeProgramAwareDashboards(role)
        ? [...dashboardItemsBase, ...dashboardItemsFacultyAware]
        : dashboardItemsBase),
      // `can()` reads the PRIMARY role, not the effective one (UserScope
      // phase 2 is still pending), and so does the api's @Authorized — so
      // this one entry must follow `user.role` or the nav would offer a
      // page the server then bounces to /no-access.
      ...(canSeeUsage(user?.role) ? [usageItem] : []),
    ],
  };
}

// Teaching & Learning is a deep analytical surface (AUN-QA criteria per
// programme), not a raw dashboard — so it lives here rather than under
// Dashboards. It stays behind canSeeProgramAwareDashboards() because the
// page itself guards with assertCanSeeFacultyDashboards; showing it to a
// role that can't open it would just route them to an error page.
const teachingLearningItem = {
  href: '/teaching-learning',
  label: 'Teaching & Learning',
  icon: createElement(ClipboardCheck),
  moduleKey: 'neutral' as const,
};

function analysisSectionFor(user: SessionUser | undefined): NavSection {
  // Same effectiveRole-over-role resolution as dashboardsSectionFor().
  const role = user?.effectiveRole ?? user?.role;
  return {
    label: 'Analysis',
    items: [
      { href: '/programs', label: 'Program Deep-Dive', icon: createElement(Building2), moduleKey: 'programs' },
      ...(canSeeProgramAwareDashboards(role) ? [teachingLearningItem] : []),
      { href: '/risks', label: 'Risk Management', icon: createElement(ShieldAlert), moduleKey: 'neutral' },
      { href: '/trends', label: 'Trends Radar', icon: createElement(Sparkles), moduleKey: 'trends' },
      { href: '/gap-analysis', label: 'Gap Analyzer', icon: createElement(SplitSquareVertical), moduleKey: 'gap' },
      { href: '/benchmarking', label: 'Benchmarking', icon: createElement(LineChart), moduleKey: 'benchmarking' },
      { href: '/scenarios', label: 'Scenario Planner', icon: createElement(GitCompare), moduleKey: 'scenarios' },
      { href: '/analyst', label: 'AI Analyst', icon: createElement(Microscope), moduleKey: 'analyst' },
      // /analyst/dashboards is still mounted (used by the FAB's "Open full
      // view" deep-link for conversation history), but no longer surfaces
      // as a top-level menu entry — the floating chat widget on every
      // authenticated page is the primary entry point.
    ],
  };
}

// Admin — single sidebar entry pointing at /admin. The landing page
// expands into three groups (Programs / External data / Application)
// — see apps/web/app/admin/page.tsx for the full grid.
const adminSection: NavSection = {
  label: 'Admin',
  items: [
    {
      href: '/admin',
      label: 'Admin console',
      icon: createElement(Wrench),
      moduleKey: 'neutral',
    },
  ],
};

// Visible to every user — the methodology paper, the acknowledgements of
// the organisations the platform's data comes from, and the release notes
// are all reference material for everyone, not just admins.
const referenceSection: NavSection = {
  label: 'Reference',
  items: [
    {
      href: '/docs/methodology',
      label: 'Methodology',
      icon: createElement(BookOpen),
      moduleKey: 'neutral',
    },
    {
      href: '/docs/acknowledgements',
      label: 'Acknowledgements',
      icon: createElement(Handshake),
      moduleKey: 'neutral',
    },
    {
      href: '/changelog',
      label: "What's new",
      icon: createElement(History),
      moduleKey: 'neutral',
    },
  ],
};

/**
 * Build the nav sections for a given user. Hides admin sections from
 * non-admin users so the sidebar stays focused on what they can do.
 */
export function appNavSectionsFor(user: SessionUser | undefined): NavSection[] {
  const sections: NavSection[] = [
    homeSection,
    dashboardsSectionFor(user),
    analysisSectionFor(user),
  ];
  if (isAdminGrade(user?.role)) {
    sections.push(adminSection);
  }
  sections.push(referenceSection);
  return sections;
}

/** Static export — preserved for any caller that doesn't have the user
    in scope. Defaults to the non-admin view. */
export const appNavSections: NavSection[] = appNavSectionsFor(undefined);
