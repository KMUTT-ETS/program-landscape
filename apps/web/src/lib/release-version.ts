import { execFileSync } from 'node:child_process';

// IMPORTANT — server-only. Never import this module from a 'use client'
// file: it reaches node:child_process, which cannot be bundled for the
// browser and takes the whole build down with it. Same rule as
// src/lib/kku/employee-api.ts.
//
// Resolves the version shown beside the sidebar copyright line.
//
// Two environments, two sources:
//
//   prod — RELEASE_VERSION comes from the container environment, passed
//          through by docker-compose from the same value that pins the
//          image tag. Authoritative; git is never consulted (the prod
//          image has no .git, and the container is read-only).
//
//   dev  — derived from git tags, because there is no release to name.
//          If HEAD sits exactly on a tag the tree is that release, so we
//          show it. If there are commits after the tag (or uncommitted
//          changes) the tree is heading somewhere NEW, so we show the
//          next possible version — the patch bump — which is what the
//          next build would be called.
//
// Never throws: a machine without git, or a tarball checkout with no
// tags, yields undefined and the label is simply omitted.

/** Bump the patch of a `1.2.3` / `v1.2.3` string. Returns null if it is not semver. */
function bumpPatch(tag: string): string | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (!m) return null;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/**
 * Turn a `git describe --tags --dirty` string into the version to display.
 *
 * Exported for tests: this is where the branch logic lives, and it is pure.
 *   `v1.8.6`                      → `1.8.6`   (HEAD is that release)
 *   `v1.8.5-53-g036efef`          → `1.8.6`   (work after the tag → next)
 *   `v1.8.5-53-g036efef-dirty`    → `1.8.6`   (same, uncommitted too)
 *   `v1.8.6-dirty`                → `1.8.7`   (on a tag but modified)
 *   `g036efef` / `` / nonsense    → undefined (cannot name it)
 */
export function parseDescribe(described: string): string | undefined {
  const s = described.trim();
  if (!s) return undefined;

  // Exactly on a clean tag. `-dirty` deliberately fails this test: a
  // modified tree is no longer the release it sits on.
  if (/^v?\d+\.\d+\.\d+$/.test(s)) return s.replace(/^v/, '');

  const base = s.match(/^v?\d+\.\d+\.\d+/)?.[0];
  if (!base) return undefined;
  return bumpPatch(base) ?? base.replace(/^v/, '');
}

function readFromGit(): string | undefined {
  let described: string;
  try {
    // --dirty so uncommitted work counts as "there are changes"; a bare
    // `describe` would call a modified tree the tag it sits on.
    described = execFileSync('git', ['describe', '--tags', '--dirty'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // No git binary, not a repo, or no tags reachable — all mean "cannot
    // name this tree", which is not an error worth surfacing in the UI.
    return undefined;
  }
  return parseDescribe(described);
}

// Memoised: this spawns a subprocess, and the answer cannot change while
// the server process lives (a dev-server restart picks up new commits).
let cached: string | undefined | null = null;

export function resolveReleaseVersion(): string | undefined {
  const fromEnv = process.env.RELEASE_VERSION?.trim();
  if (fromEnv) return fromEnv;
  if (cached === null) cached = readFromGit();
  return cached;
}
