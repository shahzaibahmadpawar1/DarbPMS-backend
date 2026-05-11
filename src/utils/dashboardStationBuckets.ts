/**
 * SQL snippets correlated to `station_information` (same row in the outer query).
 * Used by /api/dashboard/stats and /api/dashboard/stations bucket filters.
 */

/** Linked investment project is CEO-approved (`review_status = 'Approved'`). */
export const STATION_HAS_CEO_APPROVED_PROJECT_SQL = `
    EXISTS (
        SELECT 1
        FROM investment_projects p
        WHERE COALESCE(NULLIF(p.station_code, ''), p.project_code) = station_information.station_code
          AND COALESCE(p.review_status, '') = 'Approved'
    )
`;

/**
 * At least one operational form table has a row for this station (aligned with station form APIs).
 * Survey counts when any version row exists.
 */
export const STATION_HAS_ANY_FORM_DATA_SQL = `
    (
        EXISTS (SELECT 1 FROM cameras c WHERE c.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM dispensers d WHERE d.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM tanks t WHERE t.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM station_areas sa WHERE sa.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM owners o WHERE o.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM deeds de WHERE de.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM building_permits bp WHERE bp.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM contracts ct WHERE ct.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM commercial_licenses cl WHERE cl.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM salamah_licenses sl WHERE sl.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM taqyees_licenses tl WHERE tl.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM environmental_licenses el WHERE el.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM government_license_attachments gla WHERE gla.station_code = station_information.station_code)
        OR EXISTS (SELECT 1 FROM survey_report_versions srv WHERE srv.station_code = station_information.station_code)
        OR EXISTS (
            SELECT 1
            FROM nozzles n
            INNER JOIN dispensers disp ON disp.dispenser_serial_number = n.dispenser_serial_number
            WHERE disp.station_code = station_information.station_code
        )
    )
`;

/**
 * Latest survey row must be joined as `ls` (see surveyLatestVersionLateralJoin).
 * "Days left" = project delivery date minus today; show when in [0, 20].
 */
export const STATION_OPENING_SOON_DELIVERY_SQL = `
    (
        NULLIF(TRIM(ls.survey_project_delivery_date), '') IS NOT NULL
        AND (NULLIF(TRIM(ls.survey_project_delivery_date), '')::date - CURRENT_DATE) <= 20
        AND (NULLIF(TRIM(ls.survey_project_delivery_date), '')::date - CURRENT_DATE) >= 0
    )
`;

export const STATION_NEW_LAST_30_DAYS_SQL = `
    station_information.created_at >= (CURRENT_TIMESTAMP - INTERVAL '30 days')
`;
