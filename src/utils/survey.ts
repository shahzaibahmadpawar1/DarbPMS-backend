import pool from '../config/database';

let surveySchemaEnsured = false;

export const ensureSurveySchema = async (): Promise<void> => {
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

    surveySchemaEnsured = true;
};
