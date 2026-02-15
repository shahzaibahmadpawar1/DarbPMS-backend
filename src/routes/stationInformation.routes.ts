import { Router } from 'express';
import {
    createStationInformation,
    getAllStationInformation,
    getStationInformationByCode,
    updateStationInformation,
    deleteStationInformation,
    bulkCreateStationInformation
} from '../controllers/stationInformation.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Bulk create stations (Must be before general /:stationCode)
router.post('/bulk', bulkCreateStationInformation);

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
