'use client';

import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import type { ReactNode } from 'react';
import {
  ProvenanceProvider,
  ProvenanceDrawer,
  TooltipProvider,
} from '@kku/ui';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider
        attribute="data-theme"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider delayDuration={200}>
          <ProvenanceProvider>
            {children}
            <ProvenanceDrawer />
            <Toaster position="top-right" richColors />
          </ProvenanceProvider>
        </TooltipProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
