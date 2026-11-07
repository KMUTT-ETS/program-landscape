import fs from 'node:fs';
import path from 'node:path';
import type { DefaultTheme } from 'vitepress';
import { GENERATED_DIR_NAME, isExcluded } from '../src/manifest';

const gen = (name: string): string => `/${GENERATED_DIR_NAME}/${name}`;

/** One entry per docs/data-sources/*.md spec — new specs appear without editing this file. */
export function dataSourceItems(docsDir: string): DefaultTheme.SidebarItem[] {
  return fs
    .readdirSync(path.join(docsDir, 'data-sources'))
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && !isExcluded(`data-sources/${f}`))
    .sort()
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      return { text: slug, link: `/data-sources/${slug}` };
    });
}

/** The adopter journey. Order follows the adopter guide's "suggested order of work". */
export function buildSidebar(docsDir: string): DefaultTheme.SidebarItem[] {
  return [
    {
      text: 'Start here',
      items: [
        { text: 'Adopter guide', link: '/adopters/README' },
        { text: 'Licensing', link: '/licensing' },
        { text: 'Getting started', link: '/tutorials/getting-started' },
        { text: 'Windows setup (WSL2)', link: '/guides/windows-wsl2' },
        { text: 'Windows setup (WSL2) (Thai)', link: '/guides/windows-wsl2.th' },
        { text: 'Architecture', link: '/architecture' },
        { text: 'Evaluation pipeline', link: '/evaluation-pipeline' },
        { text: 'Project contract & decision log', link: gen('project-contract') },
      ],
    },
    {
      text: 'Tutorials',
      items: [
        { text: 'Overview', link: '/tutorials/README' },
        { text: 'Getting started', link: '/tutorials/getting-started' },
        { text: 'Get Program Deep-Dive working', link: '/tutorials/program-deep-dive' },
        { text: 'Deep-Dive data map', link: '/adopters/deep-dive-data-map' },
        { text: 'Workshop guide', link: '/tutorials/workshop' },
        { text: 'Tutorials overview (Thai)', link: '/tutorials/README.th' },
        { text: 'Getting started (Thai)', link: '/tutorials/getting-started.th' },
        { text: 'Get Program Deep-Dive working (Thai)', link: '/tutorials/program-deep-dive.th' },
        { text: 'Workshop guide (Thai)', link: '/tutorials/workshop.th' },
        { text: 'Fresh checkout setup (moved)', link: '/guides/fresh-checkout-setup' },
        { text: 'Adapt the registrar connector (advanced)', link: '/tutorials/adapt-the-registrar-connector' },
      ],
    },
    {
      text: 'Workshop',
      items: [
        { text: 'Overview', link: '/workshop/README' },
        { text: 'Before the day', link: '/workshop/00-before-the-day' },
        { text: 'Overview (Thai)', link: '/workshop/README.th' },
        { text: 'Before the day (Thai)', link: '/workshop/00-before-the-day.th' },
      ],
    },
    {
      text: 'Data integration',
      items: [
        { text: 'Ingestion framework', link: '/data-sources' },
        { text: 'Importing from spreadsheets', link: '/data-import' },
        { text: 'Importing from spreadsheets (Thai)', link: '/data-import.th' },
        { text: 'Source catalogue', link: '/data-sources/README' },
        { text: 'Per-source specs', collapsed: true, items: dataSourceItems(docsDir) },
        { text: 'JobThai acknowledgement', link: '/acknowledgements/jobthai' },
        { text: 'Connector session template', link: gen('connector-session-template') },
        { text: 'Migration policy', link: '/migration-policy' },
        { text: 'DB indexes', link: '/db-indexes' },
        { text: 'Dev database safety', link: '/dev-database-safety' },
      ],
    },
    {
      text: 'Documents & PDFs',
      items: [
        { text: 'PDF ingestion', link: '/pdf-ingestion' },
        { text: 'PDF generation', link: '/pdf-generation' },
        { text: 'Gotenberg fonts', link: gen('gotenberg-fonts') },
        { text: 'MarkItDown', link: '/markitdown' },
      ],
    },
    {
      text: 'AI layer',
      items: [
        { text: 'AI governance', link: '/ai-governance' },
        { text: 'Prompt standard', link: '/prompt-standard' },
        { text: 'Evaluation & accuracy', link: '/methodologies/ai-extraction-accuracy' },
        { text: 'Trend monitors', link: '/trend-monitors' },
        { text: 'Dashboard chatbot tests', link: '/dashboard-chatbot-tests' },
      ],
    },
    {
      text: 'Methodologies',
      collapsed: true,
      items: [
        { text: 'Overview', link: '/methodologies/README' },
        { text: 'Health score', link: '/methodologies/health-score' },
        { text: 'Programme health & lifecycle', link: '/methodologies/program-health-and-lifecycle' },
        { text: 'Programme health & lifecycle (Thai)', link: '/methodologies/program-health-and-lifecycle.th' },
        { text: 'Risk scoring', link: '/methodologies/risk-scoring' },
        { text: 'Risk management', link: '/methodologies/risk-management' },
        { text: 'Forecasting', link: '/methodologies/forecasting' },
        { text: 'Scenario engine', link: '/methodologies/scenario-engine' },
        { text: 'Gap map', link: '/methodologies/gap-map' },
        { text: 'Programme overlap', link: '/methodologies/program-overlap' },
        { text: 'Landscape atlas', link: '/methodologies/landscape-atlas' },
        { text: 'Cost allocation', link: '/methodologies/cost-allocation' },
        { text: 'Evaluations', link: '/methodologies/evaluations' },
        { text: 'Class GPA', link: '/methodologies/class-gpa' },
        { text: 'Cross-scope consistency', link: '/methodologies/cross-scope-consistency' },
        { text: 'Verdict stability', link: '/methodologies/verdict-stability' },
      ],
    },
    {
      text: 'UI & branding',
      items: [
        { text: 'Design system', link: '/design-system' },
        { text: 'Profile page', link: '/profile-page' },
        { text: 'Glossary TH–EN', link: '/glossary-th-en' },
      ],
    },
    {
      text: 'Auth, security & privacy',
      items: [
        { text: 'KKU SSO', link: '/auth/kku-sso' },
        { text: 'RBAC', link: '/auth/rbac' },
        { text: 'Security review', link: '/security-review' },
        { text: 'PDPA', link: '/pdpa' },
        { text: 'DSAR workflow', link: '/dsar-workflow' },
      ],
    },
    {
      text: 'Deploy & operate',
      items: [
        { text: 'Deployment', link: gen('deployment') },
        { text: 'Production infrastructure', link: '/production-infrastructure' },
        { text: 'Network integration', link: '/deployment/kku-network-integration' },
        { text: 'Backup & DR', link: '/backup-dr' },
        { text: 'Admin runbook', link: '/guides/admin-runbook' },
        { text: 'Readiness checklist', link: '/readiness-checklist' },
        { text: 'Rollout plan', link: '/rollout-plan' },
        { text: 'Security policy', link: gen('security-policy') },
      ],
    },
    {
      text: 'Integrations',
      items: [{ text: 'Staff Profile API', link: '/integrations/staff-profile-api' }],
    },
    {
      text: 'ภาษาไทย (Thai)',
      items: [{ text: 'คู่มือสำหรับสถาบันผู้นำไปใช้', link: '/adopters/README.th' }],
    },
    {
      text: 'Reference',
      items: [
        { text: 'pnpm scripts', link: gen('scripts') },
        { text: 'Environment variables', link: gen('env') },
        { text: 'Repository README', link: gen('readme') },
      ],
    },
  ];
}
