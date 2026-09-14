'use client';

// Records a page view whenever the route, scope or programme changes. No UI,
// no React state, never throws. Sent as a same-origin beacon so it costs the
// page nothing; identity is added by the API from the session cookie.

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { buildEvent, RecorderDedupe, type UsageEvent } from '@/lib/usage-recorder-policy';

// Targets the Next.js route handler (app/api/usage/page-views/route.ts),
// NOT /api/v1 directly. The /api/v1 vs /api/auth origin split only exists
// behind prod's internal nginx — in dev there is no proxy in front of the
// api, so a same-origin browser call to /api/v1 would 404. The route
// handler forwards server-side to POST /api/v1/usage/page-views, making
// dev and prod behave identically from here.
const ENDPOINT = '/api/usage/page-views';

function send(event: UsageEvent): void {
  const json = JSON.stringify(event);
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // A JSON Blob so NestJS parses the body; sendBeacon cannot set headers.
      if (navigator.sendBeacon(ENDPOINT, new Blob([json], { type: 'application/json' }))) return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // never surface
  }
}

export function UsageRecorder() {
  const pathname = usePathname();
  const params = useSearchParams();
  const dedupe = useRef<RecorderDedupe | null>(null);
  dedupe.current ??= new RecorderDedupe();
  const scope = params?.get('scope') ?? '';
  const scopeId = params?.get('scopeId') ?? '';

  useEffect(() => {
    if (!pathname) return;
    const e = buildEvent(
      pathname,
      new URLSearchParams({ ...(scope ? { scope } : {}), ...(scopeId ? { scopeId } : {}) }),
    );
    if (!e) return;
    if (!dedupe.current?.shouldSend(e, Date.now())) return;
    send(e);
  }, [pathname, scope, scopeId]);

  return null;
}
