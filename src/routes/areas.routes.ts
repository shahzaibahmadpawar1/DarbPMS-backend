import { Router } from 'express';
import {
    createArea,
    getAllAreas,
    getAreasByStation,
    updateArea,
    getLatestSavedArea,
} from '../controllers/areas.controller';
import { authenticateToken, requireCapability, requireStationDepartmentAccess, requireDepartmentAccessByLookup } from '../middleware/auth';

const areaDepartmentLookup = `
    SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
    FROM station_areas sa
    INNER JOIN station_information si ON si.station_code = sa.station_code
    WHERE sa.id = $1
    LIMIT 1
`;

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Create new area entry
router.post('/', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createArea);

// Get all area entries
router.get('/', requireCapability('view'), getAllAreas);
router.get('/latest-saved', requireCapability('view'), getLatestSavedArea);

// Get area entries by station code
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getAreasByStation);
router.put('/:id', requireCapability('edit'), requireDepartmentAccessByLookup(areaDepartmentLookup, 'id'), updateArea);

export default router;
