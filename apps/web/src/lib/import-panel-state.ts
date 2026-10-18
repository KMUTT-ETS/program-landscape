// Pure decisions behind the import panel's controls.
//
// apps/web has no jsdom and no @testing-library, so component assertions go
// through renderToStaticMarkup and cannot exercise a click. The repo's answer
// to that — stated in apps/web/vitest.config.ts — is to keep the state machine
// out of the component, where it can be tested exhaustively without a DOM.

export interface StartOverGateInput {
  /** What the operator typed into the confirmation box. */
  confirmName: string;
  /** The dataset's title, which they must reproduce exactly. */
  title: string;
  /** Batches that still own rows. Nothing to clear means nothing to do. */
  liveBatchCount: number;
  busy: boolean;
}

/**
 * Whether "Clear this dataset" may be pressed.
 *
 * Surrounding whitespace is forgiven because it is an artefact of pasting,
 * not of intent; case and spelling are not, because reproducing the name is
 * the whole point of the confirmation.
 */
export function canStartOver(input: StartOverGateInput): boolean {
  return startOverBlockedReason(input) === null;
}

/**
 * Why "Clear this dataset" cannot be pressed, in words, or null when it can.
 *
 * A disabled destructive control that will not say what it is waiting for
 * leaves the operator typing the name again and wondering which character is
 * wrong. The commonest case is not a typo at all: there is nothing to clear,
 * because start-over only ever removes rows an import created.
 */
export function startOverBlockedReason(input: StartOverGateInput): string | null {
  if (input.busy) return 'Working…';
  if (input.liveBatchCount <= 0) {
    return (
      'Nothing to clear: no upload has added rows to this dataset. Rows that ' +
      'came from a connector or the original setup are never removed by this.'
    );
  }
  if (input.confirmName.trim() === '') {
    return `Type "${input.title}" above to confirm.`;
  }
  if (input.confirmName.trim() !== input.title) {
    return `That does not match. Type "${input.title}" exactly, including capitals.`;
  }
  return null;
}

export interface UploadFailure {
  message: string;
  errors: readonly { row: number; column: string | null; message: string }[];
}

/**
 * Whether a refusal is the shrink guard and NOTHING else — the one failure an
 * operator may legitimately override, because the file really is a smaller,
 * correct export.
 *
 * Every error must be that one. Offering "upload anyway" beside a privacy or
 * a bad-cell refusal would promise something the button cannot deliver: the
 * override only relaxes the size check, so the re-upload would be refused
 * again, and next to a national-ID message it reads as an invitation to force
 * personal data through.
 */
export function isOverridableShrinkRefusal(failure: UploadFailure): boolean {
  if (failure.errors.length === 0) return false;
  return failure.errors.every((e) => e.row === 0 && /partial export/i.test(e.message));
}

/** The sentence shown after a successful upload. */
export function describeUploadOutcome(outcome: {
  deduplicated: boolean;
  rowCount: number;
  inserted: number;
  updated: number;
}): string {
  if (outcome.deduplicated) {
    return 'That exact file has already been uploaded — nothing changed.';
  }
  return (
    `Loaded ${outcome.rowCount} rows — ${outcome.inserted} added, ${outcome.updated} updated.`
  );
}
