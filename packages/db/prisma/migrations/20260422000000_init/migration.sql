-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "ProgramLevel" AS ENUM ('BACHELOR', 'MASTER', 'DOCTORAL');

-- CreateEnum
CREATE TYPE "ProgramStatus" AS ENUM ('ACTIVE', 'PAUSED', 'SUNSET');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('VIEWER', 'COUNCIL', 'EXECUTIVE', 'DEAN', 'DEPT_HEAD', 'ANALYST', 'ADMIN');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CurriculumStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CourseType" AS ENUM ('CORE', 'ELECTIVE', 'GENERAL');

-- CreateEnum
CREATE TYPE "SkillTaxonomy" AS ENUM ('LIGHTCAST', 'ESCO', 'TPQI', 'KKU');

-- CreateEnum
CREATE TYPE "SkillSource" AS ENUM ('MANUAL', 'LLM_EXTRACTED');

-- CreateEnum
CREATE TYPE "FacultyRank" AS ENUM ('LECTURER', 'ASST_PROF', 'ASSOC_PROF', 'PROF');

-- CreateEnum
CREATE TYPE "ProgramFacultyRole" AS ENUM ('COORDINATOR', 'CORE', 'SUPPORT');

-- CreateEnum
CREATE TYPE "ResearchOutputType" AS ENUM ('JOURNAL', 'CONFERENCE', 'PATENT', 'BOOK');

-- CreateEnum
CREATE TYPE "PolicySource" AS ENUM ('MHESI', 'NESDC', 'NXPO', 'BOI', 'EECO', 'OTHER');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS');

-- CreateEnum
CREATE TYPE "PdfSourceCategory" AS ENUM ('POLICY', 'REPORT', 'CURRICULUM', 'PEER_PROGRAM', 'SURVEY', 'COMMITTEE_MINUTES', 'OTHER');

-- CreateEnum
CREATE TYPE "PdfLanguage" AS ENUM ('TH', 'EN', 'MIXED');

-- CreateEnum
CREATE TYPE "PdfProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PdfExtractionType" AS ENUM ('POLICY_DOC', 'JOB_POSTING_BATCH', 'CURRICULUM_SPEC', 'PEER_PROGRAM', 'LABOR_STAT', 'SURVEY_RESULT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('AUTO_APPROVED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScenarioScope" AS ENUM ('UNIVERSITY', 'FACULTY', 'DEPARTMENT', 'PROGRAM');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('CLOSE', 'MERGE', 'LAUNCH', 'RESTRUCTURE', 'KEEP_AS_IS', 'OTHER');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'IMPLEMENTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('API', 'PDF', 'CSV', 'SCRAPE');

-- CreateTable
CREATE TABLE "faculties" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "faculty_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "faculty_id" TEXT NOT NULL,
    "department_id" TEXT,
    "level" "ProgramLevel" NOT NULL,
    "status" "ProgramStatus" NOT NULL DEFAULT 'ACTIVE',
    "year_established" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sso_subject" TEXT,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "faculty_id" TEXT,
    "department_id" TEXT,
    "theme_preference" "ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload_json" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_inferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "module" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "prompt_version" TEXT,
    "model" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "sources_json" JSONB,
    "tokens_input" INTEGER,
    "tokens_output" INTEGER,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_inferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curricula" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effective_year" INTEGER NOT NULL,
    "total_credits" INTEGER NOT NULL,
    "mko2_document_url" TEXT,
    "source_pdf_id" TEXT,
    "status" "CurriculumStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curricula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "type" "CourseType" NOT NULL DEFAULT 'ELECTIVE',
    "description_th" TEXT,
    "description_en" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_courses" (
    "id" TEXT NOT NULL,
    "curriculum_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "curriculum_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "taxonomy_source" "SkillTaxonomy" NOT NULL,
    "category" TEXT,
    "parent_skill_id" TEXT,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_skills" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" "SkillSource" NOT NULL DEFAULT 'MANUAL',
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_skills" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_skills" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_skills" (
    "id" TEXT NOT NULL,
    "faculty_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faculty_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_members" (
    "id" TEXT NOT NULL,
    "faculty_id" TEXT NOT NULL,
    "department_id" TEXT,
    "employee_code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "rank" "FacultyRank" NOT NULL,
    "academic_qualification" TEXT,
    "specialization" TEXT,
    "date_of_birth" DATE,
    "hire_date" DATE,
    "retirement_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_faculties" (
    "id" TEXT NOT NULL,
    "faculty_member_id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "role" "ProgramFacultyRole" NOT NULL DEFAULT 'CORE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_faculties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_metrics" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "academic_year" INTEGER NOT NULL,
    "applications" INTEGER NOT NULL,
    "admitted" INTEGER NOT NULL,
    "enrolled" INTEGER NOT NULL,
    "retained_year2" INTEGER NOT NULL,
    "graduated_on_time" INTEGER NOT NULL,
    "graduated_late" INTEGER NOT NULL,
    "dropouts" INTEGER NOT NULL,
    "freshness_date" DATE NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollment_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_demographics" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "academic_year" INTEGER NOT NULL,
    "breakdown_json" JSONB NOT NULL,
    "avg_tgat_score" DOUBLE PRECISION,
    "avg_tpat_score" DOUBLE PRECISION,
    "freshness_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_demographics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_methodologies" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "effective_date" DATE NOT NULL,
    "document_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_methodologies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_metrics" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "tuition_revenue" DECIMAL(14,2) NOT NULL,
    "other_revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "direct_cost" DECIMAL(14,2) NOT NULL,
    "allocated_faculty_cost" DECIMAL(14,2) NOT NULL,
    "allocated_facility_cost" DECIMAL(14,2) NOT NULL,
    "allocated_overhead" DECIMAL(14,2) NOT NULL,
    "net_contribution" DECIMAL(14,2) NOT NULL,
    "cost_per_student" DECIMAL(14,2),
    "freshness_date" DATE NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT 'v1',
    "cost_methodology_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graduate_outcomes" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "graduation_year" INTEGER NOT NULL,
    "survey_year" INTEGER NOT NULL,
    "employment_rate" DOUBLE PRECISION NOT NULL,
    "average_salary" DECIMAL(12,2) NOT NULL,
    "job_relevance_score" DOUBLE PRECISION NOT NULL,
    "further_study_rate" DOUBLE PRECISION NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "freshness_date" DATE NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graduate_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employer_feedback" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "employer_name" TEXT NOT NULL,
    "satisfaction_score" DOUBLE PRECISION NOT NULL,
    "skill_gaps_json" JSONB NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "freshness_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employer_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_outputs" (
    "id" TEXT NOT NULL,
    "faculty_member_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "type" "ResearchOutputType" NOT NULL,
    "title" TEXT NOT NULL,
    "venue" TEXT,
    "citations" INTEGER NOT NULL DEFAULT 0,
    "scopus_id" TEXT,
    "doi" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_postings" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "employer_name" TEXT,
    "location" TEXT,
    "province" TEXT,
    "salary_min" DECIMAL(12,2),
    "salary_max" DECIMAL(12,2),
    "posted_date" DATE NOT NULL,
    "description_raw" TEXT NOT NULL,
    "embedding" vector(1536),
    "processed_at" TIMESTAMP(3),
    "source_pdf_id" TEXT,
    "freshness_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_posting_skills" (
    "id" TEXT NOT NULL,
    "job_posting_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "extracted_by" "SkillSource" NOT NULL DEFAULT 'LLM_EXTRACTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_posting_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occupation_demand" (
    "id" TEXT NOT NULL,
    "occupation_code" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "postings_count" INTEGER NOT NULL,
    "median_salary" DECIMAL(12,2),
    "growth_rate" DOUBLE PRECISION,
    "freshness_date" DATE NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "occupation_demand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_documents" (
    "id" TEXT NOT NULL,
    "source" "PolicySource" NOT NULL,
    "title" TEXT NOT NULL,
    "published_date" DATE NOT NULL,
    "url" TEXT,
    "content_raw" TEXT,
    "summary_th" TEXT,
    "summary_en" TEXT,
    "embedding" vector(1536),
    "relevant_program_ids" TEXT[],
    "relevant_skill_ids" TEXT[],
    "source_pdf_id" TEXT,
    "freshness_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trend_signals" (
    "id" TEXT NOT NULL,
    "signal_type" "SignalType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary_th" TEXT,
    "summary_en" TEXT,
    "source_url" TEXT,
    "detected_date" DATE NOT NULL,
    "impact_score" DOUBLE PRECISION NOT NULL,
    "affected_program_ids" TEXT[],
    "affected_skill_ids" TEXT[],
    "ai_inference_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trend_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peer_programs" (
    "id" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "program_name" TEXT NOT NULL,
    "program_level" "ProgramLevel" NOT NULL,
    "description_url" TEXT,
    "ranking" INTEGER,
    "last_scraped" TIMESTAMP(3) NOT NULL,
    "embedding" vector(1536),
    "source_pdf_id" TEXT,
    "freshness_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "peer_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_market_forecasts" (
    "id" TEXT NOT NULL,
    "occupation_code" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "projected_demand" INTEGER NOT NULL,
    "projected_supply" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "freshness_date" DATE NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labor_market_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demographic_projections" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "age_cohort" TEXT NOT NULL,
    "population" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "freshness_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demographic_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_documents" (
    "id" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "page_count" INTEGER NOT NULL,
    "source_category" "PdfSourceCategory" NOT NULL,
    "source_org" TEXT,
    "language" "PdfLanguage" NOT NULL DEFAULT 'TH',
    "uploaded_by_user_id" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_status" "PdfProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "extracted_text_url" TEXT,
    "ocr_applied" BOOLEAN NOT NULL DEFAULT false,
    "ocr_confidence" DOUBLE PRECISION,
    "content_hash" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pdf_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_pages" (
    "id" TEXT NOT NULL,
    "pdf_document_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "text_content" TEXT,
    "has_images" BOOLEAN NOT NULL DEFAULT false,
    "has_tables" BOOLEAN NOT NULL DEFAULT false,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_extractions" (
    "id" TEXT NOT NULL,
    "pdf_document_id" TEXT NOT NULL,
    "extraction_type" "PdfExtractionType" NOT NULL,
    "target_entity_type" TEXT NOT NULL,
    "target_entity_id" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "method_version" TEXT NOT NULL,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pdf_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_tables" (
    "id" TEXT NOT NULL,
    "pdf_document_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "table_index" INTEGER NOT NULL,
    "headers_json" JSONB NOT NULL,
    "rows_json" JSONB NOT NULL,
    "structured_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description_th" TEXT,
    "description_en" TEXT,
    "scope" "ScenarioScope" NOT NULL,
    "scope_id" TEXT,
    "assumptions_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_results" (
    "id" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION,
    "ai_inference_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenario_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "council_decisions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scenario_id" TEXT,
    "decision_type" "DecisionType" NOT NULL,
    "affected_program_ids" TEXT[],
    "rationale_th" TEXT,
    "rationale_en" TEXT,
    "effective_date" DATE,
    "status" "DecisionStatus" NOT NULL DEFAULT 'PROPOSED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "council_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "body_th" TEXT,
    "body_en" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DataSourceKind" NOT NULL,
    "base_url" TEXT,
    "accepts_pdf_uploads" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "faculties_code_key" ON "faculties"("code");

-- CreateIndex
CREATE INDEX "faculties_code_idx" ON "faculties"("code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE INDEX "departments_faculty_id_idx" ON "departments"("faculty_id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_code_key" ON "programs"("code");

-- CreateIndex
CREATE INDEX "programs_faculty_id_idx" ON "programs"("faculty_id");

-- CreateIndex
CREATE INDEX "programs_department_id_idx" ON "programs"("department_id");

-- CreateIndex
CREATE INDEX "programs_status_idx" ON "programs"("status");

-- CreateIndex
CREATE INDEX "programs_level_idx" ON "programs"("level");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_sso_subject_key" ON "users"("sso_subject");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_sso_subject_idx" ON "users"("sso_subject");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "ai_inferences_user_id_idx" ON "ai_inferences"("user_id");

-- CreateIndex
CREATE INDEX "ai_inferences_module_idx" ON "ai_inferences"("module");

-- CreateIndex
CREATE INDEX "ai_inferences_created_at_idx" ON "ai_inferences"("created_at");

-- CreateIndex
CREATE INDEX "curricula_program_id_idx" ON "curricula"("program_id");

-- CreateIndex
CREATE INDEX "curricula_effective_year_idx" ON "curricula"("effective_year");

-- CreateIndex
CREATE UNIQUE INDEX "curricula_program_id_version_key" ON "curricula"("program_id", "version");

-- CreateIndex
CREATE INDEX "courses_program_id_idx" ON "courses"("program_id");

-- CreateIndex
CREATE INDEX "courses_type_idx" ON "courses"("type");

-- CreateIndex
CREATE UNIQUE INDEX "courses_program_id_code_key" ON "courses"("program_id", "code");

-- CreateIndex
CREATE INDEX "curriculum_courses_curriculum_id_idx" ON "curriculum_courses"("curriculum_id");

-- CreateIndex
CREATE INDEX "curriculum_courses_course_id_idx" ON "curriculum_courses"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_courses_curriculum_id_course_id_semester_key" ON "curriculum_courses"("curriculum_id", "course_id", "semester");

-- CreateIndex
CREATE UNIQUE INDEX "skills_code_key" ON "skills"("code");

-- CreateIndex
CREATE INDEX "skills_code_idx" ON "skills"("code");

-- CreateIndex
CREATE INDEX "skills_taxonomy_source_idx" ON "skills"("taxonomy_source");

-- CreateIndex
CREATE INDEX "skills_parent_skill_id_idx" ON "skills"("parent_skill_id");

-- CreateIndex
CREATE INDEX "course_skills_course_id_idx" ON "course_skills"("course_id");

-- CreateIndex
CREATE INDEX "course_skills_skill_id_idx" ON "course_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_skills_course_id_skill_id_key" ON "course_skills"("course_id", "skill_id");

-- CreateIndex
CREATE INDEX "program_skills_program_id_idx" ON "program_skills"("program_id");

-- CreateIndex
CREATE INDEX "program_skills_skill_id_idx" ON "program_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_skills_program_id_skill_id_key" ON "program_skills"("program_id", "skill_id");

-- CreateIndex
CREATE INDEX "department_skills_department_id_idx" ON "department_skills"("department_id");

-- CreateIndex
CREATE INDEX "department_skills_skill_id_idx" ON "department_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_skills_department_id_skill_id_key" ON "department_skills"("department_id", "skill_id");

-- CreateIndex
CREATE INDEX "faculty_skills_faculty_id_idx" ON "faculty_skills"("faculty_id");

-- CreateIndex
CREATE INDEX "faculty_skills_skill_id_idx" ON "faculty_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_skills_faculty_id_skill_id_key" ON "faculty_skills"("faculty_id", "skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_members_employee_code_key" ON "faculty_members"("employee_code");

-- CreateIndex
CREATE INDEX "faculty_members_faculty_id_idx" ON "faculty_members"("faculty_id");

-- CreateIndex
CREATE INDEX "faculty_members_department_id_idx" ON "faculty_members"("department_id");

-- CreateIndex
CREATE INDEX "faculty_members_is_active_idx" ON "faculty_members"("is_active");

-- CreateIndex
CREATE INDEX "program_faculties_faculty_member_id_idx" ON "program_faculties"("faculty_member_id");

-- CreateIndex
CREATE INDEX "program_faculties_program_id_idx" ON "program_faculties"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_faculties_faculty_member_id_program_id_key" ON "program_faculties"("faculty_member_id", "program_id");

-- CreateIndex
CREATE INDEX "enrollment_metrics_program_id_idx" ON "enrollment_metrics"("program_id");

-- CreateIndex
CREATE INDEX "enrollment_metrics_academic_year_idx" ON "enrollment_metrics"("academic_year");

-- CreateIndex
CREATE INDEX "enrollment_metrics_freshness_date_idx" ON "enrollment_metrics"("freshness_date");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_metrics_program_id_academic_year_key" ON "enrollment_metrics"("program_id", "academic_year");

-- CreateIndex
CREATE INDEX "student_demographics_program_id_idx" ON "student_demographics"("program_id");

-- CreateIndex
CREATE INDEX "student_demographics_academic_year_idx" ON "student_demographics"("academic_year");

-- CreateIndex
CREATE UNIQUE INDEX "student_demographics_program_id_academic_year_key" ON "student_demographics"("program_id", "academic_year");

-- CreateIndex
CREATE UNIQUE INDEX "cost_methodologies_version_key" ON "cost_methodologies"("version");

-- CreateIndex
CREATE INDEX "cost_methodologies_effective_date_idx" ON "cost_methodologies"("effective_date");

-- CreateIndex
CREATE INDEX "financial_metrics_program_id_idx" ON "financial_metrics"("program_id");

-- CreateIndex
CREATE INDEX "financial_metrics_fiscal_year_idx" ON "financial_metrics"("fiscal_year");

-- CreateIndex
CREATE INDEX "financial_metrics_freshness_date_idx" ON "financial_metrics"("freshness_date");

-- CreateIndex
CREATE UNIQUE INDEX "financial_metrics_program_id_fiscal_year_key" ON "financial_metrics"("program_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "graduate_outcomes_program_id_idx" ON "graduate_outcomes"("program_id");

-- CreateIndex
CREATE INDEX "graduate_outcomes_graduation_year_idx" ON "graduate_outcomes"("graduation_year");

-- CreateIndex
CREATE UNIQUE INDEX "graduate_outcomes_program_id_graduation_year_survey_year_key" ON "graduate_outcomes"("program_id", "graduation_year", "survey_year");

-- CreateIndex
CREATE INDEX "employer_feedback_program_id_idx" ON "employer_feedback"("program_id");

-- CreateIndex
CREATE INDEX "employer_feedback_year_idx" ON "employer_feedback"("year");

-- CreateIndex
CREATE INDEX "research_outputs_faculty_member_id_idx" ON "research_outputs"("faculty_member_id");

-- CreateIndex
CREATE INDEX "research_outputs_year_idx" ON "research_outputs"("year");

-- CreateIndex
CREATE INDEX "research_outputs_scopus_id_idx" ON "research_outputs"("scopus_id");

-- CreateIndex
CREATE INDEX "job_postings_source_idx" ON "job_postings"("source");

-- CreateIndex
CREATE INDEX "job_postings_posted_date_idx" ON "job_postings"("posted_date");

-- CreateIndex
CREATE INDEX "job_postings_province_idx" ON "job_postings"("province");

-- CreateIndex
CREATE UNIQUE INDEX "job_postings_source_external_id_key" ON "job_postings"("source", "external_id");

-- CreateIndex
CREATE INDEX "job_posting_skills_job_posting_id_idx" ON "job_posting_skills"("job_posting_id");

-- CreateIndex
CREATE INDEX "job_posting_skills_skill_id_idx" ON "job_posting_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_posting_skills_job_posting_id_skill_id_key" ON "job_posting_skills"("job_posting_id", "skill_id");

-- CreateIndex
CREATE INDEX "occupation_demand_occupation_code_idx" ON "occupation_demand"("occupation_code");

-- CreateIndex
CREATE INDEX "occupation_demand_province_idx" ON "occupation_demand"("province");

-- CreateIndex
CREATE INDEX "occupation_demand_year_month_idx" ON "occupation_demand"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "occupation_demand_occupation_code_province_year_month_key" ON "occupation_demand"("occupation_code", "province", "year", "month");

-- CreateIndex
CREATE INDEX "policy_documents_source_idx" ON "policy_documents"("source");

-- CreateIndex
CREATE INDEX "policy_documents_published_date_idx" ON "policy_documents"("published_date");

-- CreateIndex
CREATE INDEX "trend_signals_signal_type_idx" ON "trend_signals"("signal_type");

-- CreateIndex
CREATE INDEX "trend_signals_detected_date_idx" ON "trend_signals"("detected_date");

-- CreateIndex
CREATE INDEX "peer_programs_institution_idx" ON "peer_programs"("institution");

-- CreateIndex
CREATE INDEX "peer_programs_country_idx" ON "peer_programs"("country");

-- CreateIndex
CREATE INDEX "peer_programs_program_level_idx" ON "peer_programs"("program_level");

-- CreateIndex
CREATE INDEX "labor_market_forecasts_occupation_code_idx" ON "labor_market_forecasts"("occupation_code");

-- CreateIndex
CREATE INDEX "labor_market_forecasts_region_idx" ON "labor_market_forecasts"("region");

-- CreateIndex
CREATE INDEX "labor_market_forecasts_year_idx" ON "labor_market_forecasts"("year");

-- CreateIndex
CREATE UNIQUE INDEX "labor_market_forecasts_occupation_code_region_year_source_key" ON "labor_market_forecasts"("occupation_code", "region", "year", "source");

-- CreateIndex
CREATE INDEX "demographic_projections_region_idx" ON "demographic_projections"("region");

-- CreateIndex
CREATE INDEX "demographic_projections_year_idx" ON "demographic_projections"("year");

-- CreateIndex
CREATE UNIQUE INDEX "demographic_projections_region_year_age_cohort_source_key" ON "demographic_projections"("region", "year", "age_cohort", "source");

-- CreateIndex
CREATE UNIQUE INDEX "pdf_documents_content_hash_key" ON "pdf_documents"("content_hash");

-- CreateIndex
CREATE INDEX "pdf_documents_source_category_idx" ON "pdf_documents"("source_category");

-- CreateIndex
CREATE INDEX "pdf_documents_processing_status_idx" ON "pdf_documents"("processing_status");

-- CreateIndex
CREATE INDEX "pdf_documents_uploaded_at_idx" ON "pdf_documents"("uploaded_at");

-- CreateIndex
CREATE INDEX "pdf_pages_pdf_document_id_idx" ON "pdf_pages"("pdf_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "pdf_pages_pdf_document_id_page_number_key" ON "pdf_pages"("pdf_document_id", "page_number");

-- CreateIndex
CREATE INDEX "pdf_extractions_pdf_document_id_idx" ON "pdf_extractions"("pdf_document_id");

-- CreateIndex
CREATE INDEX "pdf_extractions_extraction_type_idx" ON "pdf_extractions"("extraction_type");

-- CreateIndex
CREATE INDEX "pdf_extractions_review_status_idx" ON "pdf_extractions"("review_status");

-- CreateIndex
CREATE INDEX "pdf_extractions_target_entity_type_target_entity_id_idx" ON "pdf_extractions"("target_entity_type", "target_entity_id");

-- CreateIndex
CREATE INDEX "pdf_tables_pdf_document_id_idx" ON "pdf_tables"("pdf_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "pdf_tables_pdf_document_id_page_number_table_index_key" ON "pdf_tables"("pdf_document_id", "page_number", "table_index");

-- CreateIndex
CREATE INDEX "scenarios_user_id_idx" ON "scenarios"("user_id");

-- CreateIndex
CREATE INDEX "scenarios_scope_scope_id_idx" ON "scenarios"("scope", "scope_id");

-- CreateIndex
CREATE INDEX "scenario_results_scenario_id_idx" ON "scenario_results"("scenario_id");

-- CreateIndex
CREATE INDEX "scenario_results_metric_idx" ON "scenario_results"("metric");

-- CreateIndex
CREATE INDEX "council_decisions_user_id_idx" ON "council_decisions"("user_id");

-- CreateIndex
CREATE INDEX "council_decisions_decision_type_idx" ON "council_decisions"("decision_type");

-- CreateIndex
CREATE INDEX "council_decisions_status_idx" ON "council_decisions"("status");

-- CreateIndex
CREATE INDEX "annotations_user_id_idx" ON "annotations"("user_id");

-- CreateIndex
CREATE INDEX "annotations_entity_type_entity_id_idx" ON "annotations"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_name_key" ON "data_sources"("name");

-- CreateIndex
CREATE INDEX "data_sources_kind_idx" ON "data_sources"("kind");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_inferences" ADD CONSTRAINT "ai_inferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_source_pdf_id_fkey" FOREIGN KEY ("source_pdf_id") REFERENCES "pdf_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_courses" ADD CONSTRAINT "curriculum_courses_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_courses" ADD CONSTRAINT "curriculum_courses_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_parent_skill_id_fkey" FOREIGN KEY ("parent_skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_skills" ADD CONSTRAINT "course_skills_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_skills" ADD CONSTRAINT "course_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_skills" ADD CONSTRAINT "program_skills_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_skills" ADD CONSTRAINT "program_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_skills" ADD CONSTRAINT "department_skills_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_skills" ADD CONSTRAINT "department_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_skills" ADD CONSTRAINT "faculty_skills_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_skills" ADD CONSTRAINT "faculty_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_members" ADD CONSTRAINT "faculty_members_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_members" ADD CONSTRAINT "faculty_members_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_faculties" ADD CONSTRAINT "program_faculties_faculty_member_id_fkey" FOREIGN KEY ("faculty_member_id") REFERENCES "faculty_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_faculties" ADD CONSTRAINT "program_faculties_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_metrics" ADD CONSTRAINT "enrollment_metrics_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_demographics" ADD CONSTRAINT "student_demographics_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_metrics" ADD CONSTRAINT "financial_metrics_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_metrics" ADD CONSTRAINT "financial_metrics_cost_methodology_id_fkey" FOREIGN KEY ("cost_methodology_id") REFERENCES "cost_methodologies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graduate_outcomes" ADD CONSTRAINT "graduate_outcomes_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_feedback" ADD CONSTRAINT "employer_feedback_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_outputs" ADD CONSTRAINT "research_outputs_faculty_member_id_fkey" FOREIGN KEY ("faculty_member_id") REFERENCES "faculty_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_source_pdf_id_fkey" FOREIGN KEY ("source_pdf_id") REFERENCES "pdf_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_posting_skills" ADD CONSTRAINT "job_posting_skills_job_posting_id_fkey" FOREIGN KEY ("job_posting_id") REFERENCES "job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_posting_skills" ADD CONSTRAINT "job_posting_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_source_pdf_id_fkey" FOREIGN KEY ("source_pdf_id") REFERENCES "pdf_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trend_signals" ADD CONSTRAINT "trend_signals_ai_inference_id_fkey" FOREIGN KEY ("ai_inference_id") REFERENCES "ai_inferences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_programs" ADD CONSTRAINT "peer_programs_source_pdf_id_fkey" FOREIGN KEY ("source_pdf_id") REFERENCES "pdf_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_documents" ADD CONSTRAINT "pdf_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_pages" ADD CONSTRAINT "pdf_pages_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_extractions" ADD CONSTRAINT "pdf_extractions_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_extractions" ADD CONSTRAINT "pdf_extractions_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_tables" ADD CONSTRAINT "pdf_tables_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_results" ADD CONSTRAINT "scenario_results_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_results" ADD CONSTRAINT "scenario_results_ai_inference_id_fkey" FOREIGN KEY ("ai_inference_id") REFERENCES "ai_inferences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_decisions" ADD CONSTRAINT "council_decisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_decisions" ADD CONSTRAINT "council_decisions_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
