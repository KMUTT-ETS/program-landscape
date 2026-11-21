// Methodology version stamped on every lifecycle verdict.
//
// UPSTREAM_LIFECYCLE_VERSION is the upstream (KKU) formula version. An
// adopting institution does NOT edit it: it sets
// LIFECYCLE_INSTITUTION_REVISION in ./tuning.ts, and LIFECYCLE_VERSION
// becomes '<upstream>+<revision>'.
//
// Version history: ./README.md.

import { LIFECYCLE_INSTITUTION_REVISION } from './tuning';

export const UPSTREAM_LIFECYCLE_VERSION = 'lifecycle.v1.4';

export const LIFECYCLE_VERSION: string =
  LIFECYCLE_INSTITUTION_REVISION === null
    ? UPSTREAM_LIFECYCLE_VERSION
    : `${UPSTREAM_LIFECYCLE_VERSION}+${LIFECYCLE_INSTITUTION_REVISION}`;
