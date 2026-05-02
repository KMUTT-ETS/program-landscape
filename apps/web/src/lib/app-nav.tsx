import type { NavSection } from '@kku/ui';
import type { SessionUser } from '@kku/shared';
import {
  Activity,
  BrainCircuit,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Database,
  FileSearch,
  GitBranch,
  GitCompare,
  Home,
  LayoutDashboard,
  LineChart,
  Microscope,
  Palette,
  PieChart,
  Sparkles,
  SplitSquareVertical,
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
    { href: '/benchmarking', label: 'Benchmarking', icon: createElement(LineChart), moduleKey: 'benchmarking' },
    { href: '/analyst', label: 'AI Analyst', icon: createElement(Microscope), moduleKey: 'analyst' },
    { href: '/decisions', label: 'Decisions', icon: createElement(ClipboardList), moduleKey: 'decisions' },
  ],
};

const workSection: NavSection = {
  label: 'Work',
  items: [
    { href: '/', label: 'Home', icon: createElement(Home), moduleKey: 'neutral' },
  ],
};

// Admin-only — populated only when the viewer is ADMIN or ANALYST.
// Three groups so the nav doesn't become a flat 10-item dump:
//   - Data setup → upload + organise the inputs the AI analyses
//   - Review     → human-in-the-loop queues
//   - System     → operations + observability
const adminDataSetupSection: NavSection = {
  label: 'Data setup',
  items: [
    { href: '/admin/data-setup', label: 'Setup hub', icon: createElement(LayoutDashboard), moduleKey: 'neutral' },
    { href: '/admin/programs', label: 'Programs', icon: createElement(Building2), moduleKey: 'neutral' },
    { href: '/admin/programs/pipeline', label: 'Curriculum pipeline', icon: createElement(GitBranch), moduleKey: 'neutral' },
    { href: '/admin/data-sources', label: 'Connectors / feeds', icon: createElement(Database), moduleKey: 'neutral' },
  ],
};

const adminReviewSection: NavSection = {
  label: 'Review queues',
  items: [
    { href: '/admin/pdf-review', label: 'PDF intake review', icon: createElement(FileSearch), moduleKey: 'neutral' },
    { href: '/admin/extraction-review', label: 'AI extraction review', icon: createElement(BrainCircuit), moduleKey: 'neutral' },
    { href: '/admin/data-quality', label: 'Data quality', icon: createElement(ClipboardCheck), moduleKey: 'neutral' },
  ],
};

const adminSystemSection: NavSection = {
  label: 'System',
  items: [
    { href: '/admin/system-status', label: 'System status', icon: createElement(Activity), moduleKey: 'neutral' },
    { href: '/styleguide', label: 'Styleguide', icon: createElement(Palette), moduleKey: 'neutral' },
  ],
};

/**
 * Build the nav sections for a given user. Hides admin sections from
 * non-admin users so the sidebar stays focused on what they can do.
 */
export function appNavSectionsFor(user: SessionUser | undefined): NavSection[] {
  const sections: NavSection[] = [workSection, moduleSection];
  if (user?.role === 'ADMIN' || user?.role === 'ANALYST') {
    sections.push(adminDataSetupSection, adminReviewSection, adminSystemSection);
  }
  return sections;
}

/** Static export — preserved for any caller that doesn't have the user
    in scope. Defaults to the non-admin view. */
export const appNavSections: NavSection[] = appNavSectionsFor(undefined);
