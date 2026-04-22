'use client';

import * as React from 'react';
import { Drawer, DrawerBody, DrawerContent, DrawerHeader, DrawerTitle } from '../primitives/drawer';

// Linear-style slide-in detail panel. Not a full page — keeps the caller's
// context in view on the left. Charts that open "drill into this
// program" open one of these rather than navigating.

export interface RightPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  widthClass?: string;
}

export function RightPanel({
  open,
  onOpenChange,
  title,
  children,
  widthClass = 'w-[min(520px,90vw)]',
}: RightPanelProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent widthClass={widthClass}>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody>{children}</DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
