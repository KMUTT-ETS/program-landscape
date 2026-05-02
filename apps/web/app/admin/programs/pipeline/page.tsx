import { redirect } from 'next/navigation';

// 2026-05-02: pipeline view merged into /admin/programs as a tab.
// This route stays as a permanent redirect for old bookmarks.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Curriculum pipeline — Admin' };

export default function CurriculumPipelineRedirect() {
  redirect('/admin/programs?view=pipeline');
}
