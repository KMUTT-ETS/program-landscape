-- AlterEnum: PdfExtractionType gained COMMITTEE_MINUTES. Split out as a
-- follow-up migration because the prior pdf_intake migration had already
-- been deployed when this value was discovered missing.
ALTER TYPE "PdfExtractionType" ADD VALUE 'COMMITTEE_MINUTES';
