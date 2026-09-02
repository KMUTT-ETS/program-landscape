-- CreateEnum
CREATE TYPE "CourseCategory" AS ENUM ('GENERAL_EDUCATION', 'CORE', 'MAJOR_REQUIRED', 'MAJOR_ELECTIVE', 'FREE_ELECTIVE', 'THESIS_PROJECT', 'UNKNOWN');

-- AlterTable
ALTER TABLE "program_courses" ADD COLUMN "category" "CourseCategory";
