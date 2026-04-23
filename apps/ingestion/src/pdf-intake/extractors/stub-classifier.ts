import type { ClassificationResult, PdfClassifier, PdfContext } from '@kku/shared';

// StubClassifier — stands in until prompt 04 wires a real LLM.
//
// Behaviour:
//   - honours sourceCategoryHint if present (from the connector / uploader)
//     with low confidence (0.5) so the review UI shows it for verification
//   - otherwise returns OTHER with confidence 0 so routing sends the PDF
//     to the review queue
//
// The pipeline state transitions are identical in both cases; prompt 04
// only needs to replace this class's classify() body with real LLM output
// to unlock auto-classification.

export class StubClassifier implements PdfClassifier {
  readonly methodVersion = 'stub-v1';

  async classify(ctx: PdfContext): Promise<ClassificationResult> {
    if (ctx.sourceCategoryHint) {
      return {
        sourceCategory: ctx.sourceCategoryHint,
        language: ctx.language,
        publishingOrg: ctx.sourceOrgHint,
        // 0.5 — not high enough to auto-approve under the default
        // classifierAutoApproveThreshold (0.7), so the PDF still reaches
        // the review queue. This is deliberate: until a real classifier
        // lands, every PDF should get human eyes.
        confidence: 0.5,
        reasoning: 'Stub classifier: honouring hint from connector/upload. Real classification lands with prompt 04.',
      };
    }
    return {
      sourceCategory: 'OTHER',
      language: ctx.language,
      confidence: 0,
      reasoning: 'Stub classifier: no hint available; awaiting prompt 04 LLM wiring.',
    };
  }
}
