import { DashboardChatPanel } from '@/components/dashboard-chat/dashboard-chat-panel';

// Mounts the floating dashboard-chat panel on /staff and every
// sub-dashboard. Same component as /education layout — the panel infers
// the dashboard context from `usePathname()` and sends it as a hint.

export default function StaffLayout({
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
