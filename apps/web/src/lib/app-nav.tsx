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

// Mirrors @kku/shared/auth/roles.ts FACULTY_DASHBOARD_ROLES. Adds
// FACULTY_USER to the set that sees /education + /staff in the nav —
// they get the same UI clamped to their own faculty by the server.
function canSeeFacultyDashboards(role: string | undefined | null): boolean {
  return (
    role === 'SUPER_ADMIN' ||
    role === 'SYSTEM_ADMIN' ||
    role === 'UNIVERSITY_USER' ||
    role === 'FACULTY_USER'
  );
}
import {
  BookOpen,
  Building2,
  GitCompare,
  GraduationCap,
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
// locked to their own faculty). PROGRAM_USER stays excluded — these
// dashboards have no per-program variant.
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

function dashboardsSectionFor(user: SessionUser | undefined): NavSection {
  // Use effectiveRole when available — a user whose primary role is
  // PROGRAM_USER but who has a UserScope grant of UNIVERSITY_USER or
  // FACULTY_USER should see Education + Staff in the nav. Falls back
  // to `role` for older JWTs minted before effectiveRole landed.
  const role = user?.effectiveRole ?? user?.role;
  return {
    label: 'Dashboards',
    items: canSeeFacultyDashboards(role)
      ? [...dashboardItemsBase, ...dashboardItemsFacultyAware]
      : dashboardItemsBase,
  };
}

const analysisSection: NavSection = {
  label: 'Analysis',
  items: [
    { href: '/programs', label: 'Program Deep-Dive', icon: createElement(Building2), moduleKey: 'programs' },
    { href: '/risks', label: 'Risk Management', icon: createElement(ShieldAlert), moduleKey: 'neutral' },
    { href: '/trends', label: 'Trends Radar', icon: createElement(Sparkles), moduleKey: 'trends' },
    { href: '/gap-analysis', label: 'Gap Analyzer', icon: createElement(SplitSquareVertical), moduleKey: 'gap' },
    { href: '/benchmarking', label: 'Benchmarking', icon: createElement(LineChart), moduleKey: 'benchmarking' },
    { href: '/scenarios', label: 'Scenario Planner', icon: createElement(GitCompare), moduleKey: 'scenarios' },
    { href: '/analyst', label: 'AI Analyst', icon: createElement(Microscope), moduleKey: 'analyst' },
  ],
};

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

// Visible to every user — the public methodology paper + changelog are
// reference material for everyone, not just admins.
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
    analysisSection,
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
