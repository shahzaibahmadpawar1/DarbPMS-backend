import { Router } from 'express';
import {
    createArea,
    getAllAreas,
    getAreasByStation
} from '../controllers/areas.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Create new area entry
router.post('/', createArea);

// Get all area entries
router.get('/', getAllAreas);

// Get area entries by station code
router.get('/station/:stationCode', getAreasByStation);

export default router;
