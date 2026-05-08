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

// Mirrors @kku/shared/auth/roles.ts UNIVERSITY_WIDE_ROLES.
function isUniversityWide(role: string | undefined | null): boolean {
  return (
    role === 'SUPER_ADMIN' ||
    role === 'SYSTEM_ADMIN' ||
    role === 'UNIVERSITY_USER'
  );
}
import {
  BookOpen,
  Building2,
  ClipboardList,
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
// 2026-05-02 reorganisation: admin items moved out of the top-bar
// dropdown into a dedicated sidebar group visible only to ADMIN/ANALYST.
// Groups are ordered Work → Modules → Data setup → Review → System so
// the cognitive flow matches "what is the user doing": casual nav, then
// analytical work, then content management, then queues, then ops.

const moduleSection: NavSection = {
  label: 'Modules',
  items: [
    { href: '/cockpit', label: 'Portfolio Cockpit', icon: createElement(PieChart), moduleKey: 'cockpit' },
    { href: '/programs', label: 'Program Deep-Dive', icon: createElement(Building2), moduleKey: 'programs' },
    { href: '/trends', label: 'Trends Radar', icon: createElement(Sparkles), moduleKey: 'trends' },
    { href: '/gap-analysis', label: 'Gap Analyzer', icon: createElement(SplitSquareVertical), moduleKey: 'gap' },
    { href: '/scenarios', label: 'Scenario Planner', icon: createElement(GitCompare), moduleKey: 'scenarios' },
    { href: '/risks', label: 'Risk Management', icon: createElement(ShieldAlert), moduleKey: 'neutral' },
    { href: '/benchmarking', label: 'Benchmarking', icon: createElement(LineChart), moduleKey: 'benchmarking' },
    { href: '/analyst', label: 'AI Analyst', icon: createElement(Microscope), moduleKey: 'analyst' },
    { href: '/decisions', label: 'Decisions', icon: createElement(ClipboardList), moduleKey: 'decisions' },
  ],
};

// Always-visible part of the Work section.
const workHomeItem = { href: '/', label: 'Home', icon: createElement(Home), moduleKey: 'neutral' as const };

// University-wide-only items in the Work section. Education + Staff
// dashboards aggregate across every faculty by design — there's no
// faculty-scoped variant — so FACULTY_USER and PROGRAM_USER don't see
// them in the nav. The /education and /staff routes also gate at the
// page level (redirect to /no-access).
const workUniversityWideItems = [
  {
    href: '/education',
    label: 'Education dashboard',
    icon: createElement(GraduationCap),
    moduleKey: 'neutral' as const,
  },
  {
    href: '/staff',
    label: 'Staff dashboard',
    icon: createElement(Users),
    moduleKey: 'neutral' as const,
  },
];

function workSectionFor(user: SessionUser | undefined): NavSection {
  return {
    label: 'Work',
    items: isUniversityWide(user?.role)
      ? [workHomeItem, ...workUniversityWideItems]
      : [workHomeItem],
  };
}

// Admin — single entry collapsing what used to be 11 items in three
// groups (Data setup / Review queues / System) into one console page.
// The /admin landing route renders the full grid of admin tools.
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
  const sections: NavSection[] = [workSectionFor(user), moduleSection];
  if (isAdminGrade(user?.role)) {
    sections.push(adminSection);
  }
  sections.push(referenceSection);
  return sections;
}

/** Static export — preserved for any caller that doesn't have the user
    in scope. Defaults to the non-admin view. */
export const appNavSections: NavSection[] = appNavSectionsFor(undefined);
