import { Router } from 'express';
import {
    createArea,
    getAllAreas,
    getAreasByStation
} from '../controllers/areas.controller';
import { authenticateToken, requireCapability, requireStationDepartmentAccess } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Create new area entry
router.post('/', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createArea);

// Get all area entries
router.get('/', requireCapability('view'), getAllAreas);

// Get area entries by station code
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getAreasByStation);

export default router;
