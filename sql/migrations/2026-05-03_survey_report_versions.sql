-- Versioned survey payloads (append-on-save). Legacy survey_reports rows are backfilled on first ensureSurveySchema run in app, or run:
-- INSERT INTO survey_report_versions (station_code, payload, created_by, created_at)
-- SELECT sr.station_code, sr.payload, sr.updated_by, COALESCE(sr.updated_at, sr.created_at)
-- FROM survey_reports sr
-- WHERE NOT EXISTS (SELECT 1 FROM survey_report_versions v WHERE v.station_code = sr.station_code);

CREATE TABLE IF NOT EXISTS survey_report_versions (
    id BIGSERIAL PRIMARY KEY,
    station_code VARCHAR(120) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_survey_report_versions_station_created
    ON survey_report_versions (station_code, created_at DESC);
