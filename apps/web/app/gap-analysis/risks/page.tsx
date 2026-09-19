import { redirect } from 'next/navigation';

// The risk register owns programme risk; the old gap "risks" tab duplicated
// it from a different formula, which is how two screens came to disagree.
export default function RisksRedirect() {
  redirect('/risks');
}
