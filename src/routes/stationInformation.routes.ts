import { Router } from 'express';
import {
    createStationInformation,
    getAllStationInformation,
    getStationInformationByCode,
    updateStationInformation,
    deleteStationInformation
} from '../controllers/stationInformation.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Create new station
router.post('/', createStationInformation);

// Get all stations
router.get('/', getAllStationInformation);

// Get station by code
router.get('/:stationCode', getStationInformationByCode);

// Update station
router.put('/:stationCode', updateStationInformation);

// Delete station
router.delete('/:stationCode', deleteStationInformation);

export default router;
