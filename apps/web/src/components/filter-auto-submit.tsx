'use client';

import * as React from 'react';

// Client-side helper for FilterRail's server-form mode. Listens for
// `change` events bubbling up from <select> children of the enclosing
// <form> and calls `form.requestSubmit()` so the page re-renders with
// the new filter — without the user having to find a submit button.
//
// Why a separate client island instead of `<form onChange={…}>` on the
// FilterRail itself: FilterRail is a shared component (server + client)
// and adding an `onChange` event handler would force the whole thing to
// be a client component. Splitting the side-effect into a tiny `'use
// client'` sibling keeps the rest of the tree on the server.
//
// Only fires on <select> changes by design — typing in the search input
// emits `change` only on blur, which would commit half-typed queries
// every time the user clicks away. Keep Enter-in-search as the explicit
// commit for text and the dropdown change as the implicit commit for
// pickers.

export function FilterAutoSubmit() {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  React.useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const onChange = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Only commit on <select> changes — see comment above.
      if (target.tagName === 'SELECT') {
        submitWithCleanQuery(form);
      }
    };
    // Strip empty fields on explicit submits too (Enter in search,
    // hidden submit button click) so the URL never accumulates noise
    // like `?facultyId=&level=&status=`.
    const onSubmit = (ev: SubmitEvent) => {
      if (form.method.toLowerCase() === 'get') {
        ev.preventDefault();
        submitWithCleanQuery(form);
      }
    };
    form.addEventListener('change', onChange);
    form.addEventListener('submit', onSubmit);
    return () => {
      form.removeEventListener('change', onChange);
      form.removeEventListener('submit', onSubmit);
    };
  }, []);
  // Render a 0-size anchor we can use to find the parent form.
  return <span ref={ref} aria-hidden className="hidden" />;
}

// Build the destination URL ourselves, dropping any field whose value
// is the empty string (the "All X" option on each FilterSelect). Then
// navigate via location.assign so the form's GET semantics are
// preserved without the ugly `facultyId=&level=&…` trail in the URL.
function submitWithCleanQuery(form: HTMLFormElement): void {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [name, value] of data.entries()) {
    if (typeof value === 'string' && value.length > 0) {
      params.append(name, value);
    }
  }
  const action = form.getAttribute('action') || window.location.pathname;
  const qs = params.toString();
  window.location.assign(qs ? `${action}?${qs}` : action);
}
