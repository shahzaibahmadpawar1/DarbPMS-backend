import pool from '../config/database';

let surveySchemaEnsured = false;

/** Columns appended via LATERAL join on latest survey_report_versions row. */
export const SURVEY_CARD_SELECT_FRAGMENT = `
    ls.survey_version_id,
    ls.survey_saved_at,
    ls.survey_project_start_date,
    ls.survey_project_delivery_date,
    ls.survey_expected_date,
    ls.survey_station_status_code,
    ls.survey_station_status_stage
`;

export const surveyLatestVersionLateralJoin = (stationCodeSqlExpr: string): string => `
LEFT JOIN LATERAL (
    SELECT
        srv.id AS survey_version_id,
        srv.created_at AS survey_saved_at,
        srv.payload->>'projectStartDate' AS survey_project_start_date,
        srv.payload->>'projectDeliveryDate' AS survey_project_delivery_date,
        srv.payload->>'theDate' AS survey_expected_date,
        srv.payload->>'stationStatusCode' AS survey_station_status_code,
        srv.payload->>'stationStatusStage' AS survey_station_status_stage
    FROM survey_report_versions srv
    WHERE srv.station_code = ${stationCodeSqlExpr}
    ORDER BY srv.created_at DESC
    LIMIT 1
) ls ON true
`;

export async function ensureSurveySchema(): Promise<void> {
    if (surveySchemaEnsured) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS survey_reports (
            id BIGSERIAL PRIMARY KEY,
            station_code VARCHAR(120) NOT NULL UNIQUE,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_by UUID,
            updated_by UUID,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_survey_reports_station_code
        ON survey_reports(station_code)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_survey_reports_updated_at
        ON survey_reports(updated_at DESC)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS survey_report_versions (
            id BIGSERIAL PRIMARY KEY,
            station_code VARCHAR(120) NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_by UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_survey_report_versions_station_created
        ON survey_report_versions(station_code, created_at DESC)
    `);

    await pool.query(`
        INSERT INTO survey_report_versions (station_code, payload, created_by, created_at)
        SELECT sr.station_code, sr.payload, sr.updated_by, COALESCE(sr.updated_at, sr.created_at)
        FROM survey_reports sr
        WHERE NOT EXISTS (
            SELECT 1 FROM survey_report_versions v WHERE v.station_code = sr.station_code
        )
    `);

    surveySchemaEnsured = true;
}
