'use client';

import * as React from 'react';

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded border border-border-default px-3 py-1 text-sm hover:bg-surface-2"
    >
      Print this page
    </button>
  );
}
