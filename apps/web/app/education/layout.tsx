import { DashboardChatPanel } from '@/components/dashboard-chat/dashboard-chat-panel';

// Mounts the floating dashboard-chat panel on /education and every
// sub-dashboard. The panel itself is client-side and inert until the
// user opens it (FAB) or hits Cmd/Ctrl+/.
//
// Strategic Council questions live at /analyst. The panel pins to the
// operational dashboard tool catalog via `kind=DASHBOARD` server-side.

export default function EducationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <DashboardChatPanel />
    </>
  );
}
