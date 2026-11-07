import fs from 'node:fs';
import path from 'node:path';
import type { DefaultTheme } from 'vitepress';
import { type DataSourceTier, dataSourceTier } from '../src/data-source-tier';
import { GENERATED_DIR_NAME, isExcluded } from '../src/manifest';

const gen = (name: string): string => `/${GENERATED_DIR_NAME}/${name}`;

const TIER_GROUPS: readonly { tier: DataSourceTier; text: string }[] = [
  { tier: 'public', text: 'Public and national' },
  { tier: 'institution', text: 'Per-institution (KKU examples)' },
  { tier: 'deprecated', text: 'Deprecated' },
];

/**
 * One entry per docs/data-sources/*.md spec, grouped by adoption tier — new specs appear without
 * editing this file. Empty tiers are omitted.
 */
export function dataSourceGroups(docsDir: string): DefaultTheme.SidebarItem[] {
  const slugs = fs
    .readdirSync(path.join(docsDir, 'data-sources'))
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && !isExcluded(`data-sources/${f}`))
    .sort()
    .map((f) => f.replace(/\.md$/, ''));
  return TIER_GROUPS.map(({ tier, text }) => ({
    text,
    collapsed: true,
    items: slugs.filter((s) => dataSourceTier(s) === tier).map((s) => ({ text: s, link: `/data-sources/${s}` })),
  })).filter((g) => g.items.length > 0);
}

const METHODOLOGIES: DefaultTheme.SidebarItem = {
  text: 'Methodologies',
  collapsed: true,
  items: [
    { text: 'Overview', link: '/methodologies/README' },
    { text: 'Health score', link: '/methodologies/health-score' },
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
};

/** The English sidebar, in the order an adopter works: start, learn, do, understand, look up. */
export function buildSidebar(docsDir: string): DefaultTheme.SidebarItem[] {
  return [
    {
      text: 'Start',
      items: [
        { text: 'Adopter guide', link: '/adopters/README' },
        { text: 'Licensing', link: '/licensing' },
        { text: 'Architecture', link: '/architecture' },
      ],
    },
    {
      text: 'Tutorials',
      items: [
        { text: 'Overview', link: '/tutorials/README' },
        { text: 'Getting started', link: '/tutorials/getting-started' },
        { text: 'Windows setup (WSL2)', link: '/guides/windows-wsl2' },
        { text: 'Get Program Deep-Dive working', link: '/tutorials/program-deep-dive' },
        { text: 'Adapt the registrar connector (advanced)', link: '/tutorials/adapt-the-registrar-connector' },
      ],
    },
    {
      text: 'Workshop',
      items: [
        { text: 'Overview', link: '/workshop/README' },
        { text: 'Before the day', link: '/workshop/00-before-the-day' },
        { text: 'Session 1: environment and AI tools', link: '/workshop/01-environment-and-ai-tools' },
        { text: 'Session 2: architecture and source', link: '/workshop/02-architecture-and-source' },
        { text: 'Session 3: university data', link: '/workshop/03-university-data' },
        { text: 'Sessions 4–5: in preparation' },
        { text: 'Session 6: testing and security', link: '/workshop/06-testing-and-security' },
        { text: 'Troubleshooting', link: '/workshop/troubleshooting' },
        { text: 'Facilitator guide', link: '/workshop/facilitator' },
      ],
    },
    {
      text: 'Guides',
      items: [
        { text: 'Import from spreadsheets', link: '/data-import' },
        { text: 'Connector session template', link: gen('connector-session-template') },
        { text: 'Backup and disaster recovery', link: '/backup-dr' },
        { text: 'Staff Profile API', link: '/integrations/staff-profile-api' },
        { text: 'Dev database safety', link: '/dev-database-safety' },
        { text: 'Migration policy', link: '/migration-policy' },
      ],
    },
    {
      text: 'Concepts',
      items: [
        { text: 'Ingestion framework', link: '/data-sources' },
        { text: 'Evaluation pipeline', link: '/evaluation-pipeline' },
        { text: 'Council-readiness checklist', link: '/readiness-checklist' },
        { text: 'PDPA', link: '/pdpa' },
        { text: 'DSAR workflow', link: '/dsar-workflow' },
        { text: 'Security review', link: '/security-review' },
        { text: 'AI governance', link: '/ai-governance' },
        { text: 'Prompt standard', link: '/prompt-standard' },
        { text: 'AI extraction accuracy', link: '/methodologies/ai-extraction-accuracy' },
        { text: 'Trend monitors', link: '/trend-monitors' },
        { text: 'PDF ingestion', link: '/pdf-ingestion' },
        { text: 'PDF generation', link: '/pdf-generation' },
        { text: 'MarkItDown', link: '/markitdown' },
        { text: 'Profile page', link: '/profile-page' },
        METHODOLOGIES,
      ],
    },
    {
      text: 'Reference',
      items: [
        { text: 'pnpm scripts', link: gen('scripts') },
        { text: 'Environment variables', link: gen('env') },
        { text: 'Data-source catalogue', link: '/data-sources/README' },
        ...dataSourceGroups(docsDir),
        { text: 'RBAC', link: '/auth/rbac' },
        { text: 'Deep-Dive data map', link: '/adopters/deep-dive-data-map' },
        { text: 'Design system', link: '/design-system' },
        { text: 'Glossary TH–EN', link: '/glossary-th-en' },
        { text: 'DB indexes', link: '/db-indexes' },
        { text: 'Gotenberg fonts', link: gen('gotenberg-fonts') },
        { text: 'Security policy', link: gen('security-policy') },
        { text: 'Repository README', link: gen('readme') },
      ],
    },
  ];
}

/** Top nav: one entry per sidebar group, each opening that group's first page. */
export const NAV: DefaultTheme.NavItem[] = [
  { text: 'Start', link: '/adopters/README' },
  { text: 'Tutorials', link: '/tutorials/README' },
  { text: 'Workshop', link: '/workshop/README' },
  { text: 'Guides', link: '/data-import' },
  { text: 'Concepts', link: '/data-sources' },
  { text: 'Reference', link: gen('scripts') },
];

/** The Thai locale: the same six groups, Thai pages only. Empty groups are omitted. */
export function buildThaiSidebar(_docsDir: string): DefaultTheme.SidebarItem[] {
  const groups: DefaultTheme.SidebarItem[] = [
    {
      text: 'เริ่มต้น',
      items: [{ text: 'คู่มือสำหรับสถาบันผู้นำไปใช้', link: '/th/adopters/README' }],
    },
    {
      text: 'บทเรียน',
      items: [
        { text: 'ภาพรวม', link: '/th/tutorials/README' },
        { text: 'Getting started', link: '/th/tutorials/getting-started' },
        { text: 'การติดตั้งบน Windows ด้วย WSL2', link: '/th/guides/windows-wsl2' },
        { text: 'ทำให้ Program Deep-Dive ใช้งานได้', link: '/th/tutorials/program-deep-dive' },
      ],
    },
    {
      text: 'เวิร์กช็อป',
      items: [
        { text: 'ภาพรวม', link: '/th/workshop/README' },
        { text: 'ก่อนวันอบรม', link: '/th/workshop/00-before-the-day' },
        { text: 'Session 1: Local Environment และ AI Tools', link: '/th/workshop/01-environment-and-ai-tools' },
        { text: 'Session 2: สถาปัตยกรรมระบบและ Source Code', link: '/th/workshop/02-architecture-and-source' },
        { text: 'Session 3: การเชื่อมโยงข้อมูลมหาวิทยาลัย', link: '/th/workshop/03-university-data' },
        { text: 'Session 4–5: อยู่ระหว่างจัดทำ' },
        { text: 'Session 6: การทดสอบและความปลอดภัย', link: '/th/workshop/06-testing-and-security' },
        { text: 'การแก้ปัญหา', link: '/th/workshop/troubleshooting' },
        { text: 'คู่มือผู้จัด', link: '/th/workshop/facilitator' },
      ],
    },
    {
      text: 'คู่มือปฏิบัติ',
      items: [{ text: 'นำเข้าข้อมูลจากสเปรดชีต', link: '/th/data-import' }],
    },
    { text: 'แนวคิด', items: [] },
    { text: 'อ้างอิง', items: [] },
  ];
  return groups.filter((g) => (g.items?.length ?? 0) > 0);
}

export const THAI_NAV: DefaultTheme.NavItem[] = [
  { text: 'เริ่มต้น', link: '/th/adopters/README' },
  { text: 'บทเรียน', link: '/th/tutorials/README' },
  { text: 'เวิร์กช็อป', link: '/th/workshop/README' },
  { text: 'คู่มือปฏิบัติ', link: '/th/data-import' },
];
