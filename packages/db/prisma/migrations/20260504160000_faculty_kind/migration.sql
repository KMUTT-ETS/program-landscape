-- CreateEnum
CREATE TYPE "FacultyKind" AS ENUM ('ACADEMIC', 'ADMIN', 'INSTITUTE', 'RESEARCH_CENTER');

-- AlterTable
ALTER TABLE "faculties" ADD COLUMN "kind" "FacultyKind" NOT NULL DEFAULT 'ACADEMIC';
