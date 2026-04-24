import type { NavSection } from '@kku/ui';
import {
  Building2,
  ClipboardList,
  GitCompare,
  Home,
  LineChart,
  Microscope,
  Palette,
  PieChart,
  Sparkles,
  SplitSquareVertical,
} from 'lucide-react';
import { createElement } from 'react';

// Left-nav layout. Modules that don't exist yet show `hint: "prompt NN"`
// so we don't mislead anyone about what's wired up.

export const appNavSections: NavSection[] = [
  {
    label: 'Work',
    items: [
      { href: '/', label: 'Home', icon: createElement(Home), moduleKey: 'neutral' },
      { href: '/styleguide', label: 'Styleguide', icon: createElement(Palette), moduleKey: 'neutral' },
    ],
  },
  {
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
  },
];
