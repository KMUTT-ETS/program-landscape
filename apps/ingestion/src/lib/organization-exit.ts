// "Fail once" across a process boundary. The ai-jobs worker spawns some CLI
// scripts as child processes and sees only their exit code, so a child that
// stops on a missing organisation profile exits with a dedicated code and the
// spawning handler turns it back into OrganizationNotConfiguredError — which
// runAiJobHandler converts to BullMQ's UnrecoverableError (no retries).
import { OrganizationNotConfiguredError } from '@kku/shared';

/** sysexits.h EX_CONFIG — "configuration error". */
export const ORGANIZATION_NOT_CONFIGURED_EXIT = 78;

function isOrganizationNotConfigured(err: unknown): boolean {
  // A bundled child script carries its own copy of the class, so match the
  // name as well as the prototype.
  return (
    err instanceof OrganizationNotConfiguredError ||
    (err instanceof Error && err.name === 'OrganizationNotConfiguredError')
  );
}

/** Exit code for a script's top-level `.catch`. */
export function scriptExitCode(err: unknown): number {
  return isOrganizationNotConfigured(err) ? ORGANIZATION_NOT_CONFIGURED_EXIT : 1;
}

/** The error a spawning handler should throw for a child's exit code, or null. */
export function organizationErrorForExitCode(code: number): OrganizationNotConfiguredError | null {
  return code === ORGANIZATION_NOT_CONFIGURED_EXIT ? new OrganizationNotConfiguredError() : null;
}
