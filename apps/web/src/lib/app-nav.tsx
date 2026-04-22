import type { NavSection } from '@kku/ui';
import {
  Building2,
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
      { href: '/', label: 'Home', icon: createElement(Home) },
      { href: '/styleguide', label: 'Styleguide', icon: createElement(Palette) },
    ],
  },
  {
    label: 'Modules',
    items: [
      { href: '/cockpit', label: 'Portfolio Cockpit', icon: createElement(PieChart), hint: '05', disabled: true },
      { href: '/program', label: 'Program Deep-Dive', icon: createElement(Building2), hint: '06', disabled: true },
      { href: '/trends', label: 'Trends Radar', icon: createElement(Sparkles), hint: '07', disabled: true },
      { href: '/gap', label: 'Gap Analyzer', icon: createElement(SplitSquareVertical), hint: '08', disabled: true },
      { href: '/scenarios', label: 'Scenario Planner', icon: createElement(GitCompare), hint: '09', disabled: true },
      { href: '/benchmarking', label: 'Benchmarking', icon: createElement(LineChart), hint: '10', disabled: true },
      { href: '/analyst', label: 'AI Analyst', icon: createElement(Microscope), hint: '11', disabled: true },
    ],
  },
];
