-- Materialized views for scope rollups.
--
-- The four views share a uniform column shape (see packages/db/src/scope.ts
-- → MetricRowSchema). `year` is a unified time key sourced from the
-- underlying academic_year / fiscal_year / graduation_year columns. A row
-- exists for every (scope_id, year) pair that has at least one metric
-- family present.
--
-- Refresh strategy: REFRESH MATERIALIZED VIEW CONCURRENTLY, triggered by
-- the ingestion jobs that write the source metric tables (prompt 03). The
-- REFRESH order is bottom-up:
--   1. mv_program_metrics
--   2. mv_department_metrics
--   3. mv_faculty_metrics
--   4. mv_university_metrics
--
-- Every MV has a unique index so CONCURRENTLY is allowed.

-- ══════════════════════════════════════════════════════════════════════════
-- mv_program_metrics (program scope — pass-through aggregation per year)
-- ══════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW mv_program_metrics AS
WITH years AS (
    SELECT DISTINCT academic_year    AS year FROM enrollment_metrics
    UNION
    SELECT DISTINCT fiscal_year      AS year FROM financial_metrics
    UNION
    SELECT DISTINCT graduation_year  AS year FROM graduate_outcomes
),
program_years AS (
    SELECT p.id AS program_id, p.department_id, p.faculty_id, y.year
    FROM programs p
    CROSS JOIN years y
)
SELECT
    py.program_id,
    py.department_id,
    py.faculty_id,
    py.year,
    em.applications                                               AS applications_total,
    em.admitted                                                   AS admitted_total,
    em.enrolled                                                   AS enrolled_total,
    em.retained_year2                                             AS retained_year2_total,
    em.graduated_on_time                                          AS graduated_on_time_total,
    em.graduated_late                                             AS graduated_late_total,
    em.dropouts                                                   AS dropouts_total,
    fm.tuition_revenue                                            AS tuition_revenue_total,
    (COALESCE(fm.direct_cost, 0)
        + COALESCE(fm.allocated_faculty_cost, 0)
        + COALESCE(fm.allocated_facility_cost, 0)
        + COALESCE(fm.allocated_overhead, 0))::numeric            AS total_cost_total,
    fm.net_contribution                                           AS net_contribution_total,
    go_agg.employment_rate_weighted,
    go_agg.average_salary_weighted,
    1::int                                                        AS program_count,
    GREATEST(
        em.freshness_date,
        fm.freshness_date,
        go_agg.latest_freshness
    )                                                             AS latest_freshness
FROM program_years py
LEFT JOIN enrollment_metrics em
       ON em.program_id = py.program_id AND em.academic_year = py.year
LEFT JOIN financial_metrics fm
       ON fm.program_id = py.program_id AND fm.fiscal_year   = py.year
LEFT JOIN LATERAL (
    SELECT
        SUM(g.employment_rate * g.sample_size) / NULLIF(SUM(g.sample_size), 0) AS employment_rate_weighted,
        SUM(g.average_salary  * g.sample_size) / NULLIF(SUM(g.sample_size), 0) AS average_salary_weighted,
        MAX(g.freshness_date)                                                  AS latest_freshness
    FROM graduate_outcomes g
    WHERE g.program_id = py.program_id AND g.graduation_year = py.year
) go_agg ON TRUE;

CREATE UNIQUE INDEX mv_program_metrics_pk
    ON mv_program_metrics (program_id, year);
CREATE INDEX mv_program_metrics_dept_year
    ON mv_program_metrics (department_id, year);
CREATE INDEX mv_program_metrics_faculty_year
    ON mv_program_metrics (faculty_id, year);

-- ══════════════════════════════════════════════════════════════════════════
-- mv_department_metrics (roll up all programs in a department)
-- ══════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW mv_department_metrics AS
WITH years AS (
    SELECT DISTINCT academic_year   AS year FROM enrollment_metrics
    UNION
    SELECT DISTINCT fiscal_year     AS year FROM financial_metrics
    UNION
    SELECT DISTINCT graduation_year AS year FROM graduate_outcomes
),
dept_years AS (
    SELECT d.id AS department_id, d.faculty_id, y.year
    FROM departments d
    CROSS JOIN years y
)
SELECT
    dy.department_id,
    dy.faculty_id,
    dy.year,
    SUM(em.applications)::int          AS applications_total,
    SUM(em.admitted)::int              AS admitted_total,
    SUM(em.enrolled)::int              AS enrolled_total,
    SUM(em.retained_year2)::int        AS retained_year2_total,
    SUM(em.graduated_on_time)::int     AS graduated_on_time_total,
    SUM(em.graduated_late)::int        AS graduated_late_total,
    SUM(em.dropouts)::int              AS dropouts_total,
    SUM(fm.tuition_revenue)            AS tuition_revenue_total,
    SUM(COALESCE(fm.direct_cost, 0)
       + COALESCE(fm.allocated_faculty_cost, 0)
       + COALESCE(fm.allocated_facility_cost, 0)
       + COALESCE(fm.allocated_overhead, 0))  AS total_cost_total,
    SUM(fm.net_contribution)           AS net_contribution_total,
    (SUM(go.employment_rate * go.sample_size) / NULLIF(SUM(go.sample_size), 0))
                                       AS employment_rate_weighted,
    (SUM(go.average_salary  * go.sample_size) / NULLIF(SUM(go.sample_size), 0))
                                       AS average_salary_weighted,
    COUNT(DISTINCT p.id)::int          AS program_count,
    GREATEST(
        MAX(em.freshness_date),
        MAX(fm.freshness_date),
        MAX(go.freshness_date)
    )                                  AS latest_freshness
FROM dept_years dy
LEFT JOIN programs p
       ON p.department_id = dy.department_id
LEFT JOIN enrollment_metrics em
       ON em.program_id = p.id AND em.academic_year = dy.year
LEFT JOIN financial_metrics fm
       ON fm.program_id = p.id AND fm.fiscal_year   = dy.year
LEFT JOIN graduate_outcomes go
       ON go.program_id = p.id AND go.graduation_year = dy.year
GROUP BY dy.department_id, dy.faculty_id, dy.year;

CREATE UNIQUE INDEX mv_department_metrics_pk
    ON mv_department_metrics (department_id, year);
CREATE INDEX mv_department_metrics_faculty_year
    ON mv_department_metrics (faculty_id, year);

-- ══════════════════════════════════════════════════════════════════════════
-- mv_faculty_metrics
-- ══════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW mv_faculty_metrics AS
WITH years AS (
    SELECT DISTINCT academic_year   AS year FROM enrollment_metrics
    UNION
    SELECT DISTINCT fiscal_year     AS year FROM financial_metrics
    UNION
    SELECT DISTINCT graduation_year AS year FROM graduate_outcomes
),
fac_years AS (
    SELECT f.id AS faculty_id, y.year
    FROM faculties f
    CROSS JOIN years y
)
SELECT
    fy.faculty_id,
    fy.year,
    SUM(em.applications)::int          AS applications_total,
    SUM(em.admitted)::int              AS admitted_total,
    SUM(em.enrolled)::int              AS enrolled_total,
    SUM(em.retained_year2)::int        AS retained_year2_total,
    SUM(em.graduated_on_time)::int     AS graduated_on_time_total,
    SUM(em.graduated_late)::int        AS graduated_late_total,
    SUM(em.dropouts)::int              AS dropouts_total,
    SUM(fm.tuition_revenue)            AS tuition_revenue_total,
    SUM(COALESCE(fm.direct_cost, 0)
       + COALESCE(fm.allocated_faculty_cost, 0)
       + COALESCE(fm.allocated_facility_cost, 0)
       + COALESCE(fm.allocated_overhead, 0))  AS total_cost_total,
    SUM(fm.net_contribution)           AS net_contribution_total,
    (SUM(go.employment_rate * go.sample_size) / NULLIF(SUM(go.sample_size), 0))
                                       AS employment_rate_weighted,
    (SUM(go.average_salary  * go.sample_size) / NULLIF(SUM(go.sample_size), 0))
                                       AS average_salary_weighted,
    COUNT(DISTINCT p.id)::int          AS program_count,
    GREATEST(
        MAX(em.freshness_date),
        MAX(fm.freshness_date),
        MAX(go.freshness_date)
    )                                  AS latest_freshness
FROM fac_years fy
LEFT JOIN programs p
       ON p.faculty_id = fy.faculty_id
LEFT JOIN enrollment_metrics em
       ON em.program_id = p.id AND em.academic_year = fy.year
LEFT JOIN financial_metrics fm
       ON fm.program_id = p.id AND fm.fiscal_year   = fy.year
LEFT JOIN graduate_outcomes go
       ON go.program_id = p.id AND go.graduation_year = fy.year
GROUP BY fy.faculty_id, fy.year;

CREATE UNIQUE INDEX mv_faculty_metrics_pk
    ON mv_faculty_metrics (faculty_id, year);

-- ══════════════════════════════════════════════════════════════════════════
-- mv_university_metrics (single "kku" row per year)
-- ══════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW mv_university_metrics AS
WITH years AS (
    SELECT DISTINCT academic_year   AS year FROM enrollment_metrics
    UNION
    SELECT DISTINCT fiscal_year     AS year FROM financial_metrics
    UNION
    SELECT DISTINCT graduation_year AS year FROM graduate_outcomes
)
SELECT
    'kku'::text                        AS university_id,
    y.year,
    SUM(em.applications)::int          AS applications_total,
    SUM(em.admitted)::int              AS admitted_total,
    SUM(em.enrolled)::int              AS enrolled_total,
    SUM(em.retained_year2)::int        AS retained_year2_total,
    SUM(em.graduated_on_time)::int     AS graduated_on_time_total,
    SUM(em.graduated_late)::int        AS graduated_late_total,
    SUM(em.dropouts)::int              AS dropouts_total,
    SUM(fm.tuition_revenue)            AS tuition_revenue_total,
    SUM(COALESCE(fm.direct_cost, 0)
       + COALESCE(fm.allocated_faculty_cost, 0)
       + COALESCE(fm.allocated_facility_cost, 0)
       + COALESCE(fm.allocated_overhead, 0))  AS total_cost_total,
    SUM(fm.net_contribution)           AS net_contribution_total,
    (SUM(go.employment_rate * go.sample_size) / NULLIF(SUM(go.sample_size), 0))
                                       AS employment_rate_weighted,
    (SUM(go.average_salary  * go.sample_size) / NULLIF(SUM(go.sample_size), 0))
                                       AS average_salary_weighted,
    COUNT(DISTINCT p.id)::int          AS program_count,
    GREATEST(
        MAX(em.freshness_date),
        MAX(fm.freshness_date),
        MAX(go.freshness_date)
    )                                  AS latest_freshness
FROM years y
LEFT JOIN programs p ON TRUE
LEFT JOIN enrollment_metrics em
       ON em.program_id = p.id AND em.academic_year = y.year
LEFT JOIN financial_metrics fm
       ON fm.program_id = p.id AND fm.fiscal_year   = y.year
LEFT JOIN graduate_outcomes go
       ON go.program_id = p.id AND go.graduation_year = y.year
GROUP BY y.year;

CREATE UNIQUE INDEX mv_university_metrics_pk
    ON mv_university_metrics (university_id, year);
