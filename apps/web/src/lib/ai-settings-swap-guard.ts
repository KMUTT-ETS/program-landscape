// Pure staleness-guard helpers for the AI-settings bulk model swap UI
// (apps/web/app/admin/app/ai-settings/client.tsx). No React — kept
// separate + dependency-free so the exact sequence a slow network can
// produce (Preview fires for model X, operator changes the dropdown to
// model W before the response lands, X's response arrives after) is
// unit-testable without a DOM.
//
// Belt-and-braces: the component ALSO disables both <select>s while a
// swap request is in flight, so in practice this guard is the second
// layer, not the only one — but the selection can still move between the
// request firing and the disabled state actually blocking further input,
// and a defensive check costs nothing.

export interface SwapPreviewResponse {
  fromModelId: string;
  toModelId: string;
}

export interface SwapPreviewState {
  fromModelId: string;
  toModelId: string;
  /** Count of methods that would actually change (rewrite + create).
   *  Excludes `skipped` — a plan where everything matched is locked
   *  should not leave Apply enabled. */
  changeCount: number;
}

/** Should a just-landed preview response be accepted into state? False
 *  means the operator has since changed From/To — discard it silently. */
export function shouldAcceptSwapPreview(
  response: SwapPreviewResponse,
  currentFromModelId: string,
  currentToModelId: string,
): boolean {
  return (
    response.fromModelId === currentFromModelId && response.toModelId === currentToModelId
  );
}

/** Should the Apply button actually be allowed to fire? Requires a
 *  non-empty preview whose from/to still matches the live dropdown
 *  selection, and no request already in flight. */
export function canApplySwapPreview(
  preview: SwapPreviewState | null,
  currentFromModelId: string,
  currentToModelId: string,
  pending: boolean,
): boolean {
  if (pending || !preview) return false;
  if (preview.changeCount <= 0) return false;
  return preview.fromModelId === currentFromModelId && preview.toModelId === currentToModelId;
}
