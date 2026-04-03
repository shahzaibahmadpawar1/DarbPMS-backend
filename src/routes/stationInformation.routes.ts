import { Router } from 'express';
import {
    createStationInformation,
    getAllStationInformation,
    getStationInformationByCode,
    updateStationInformation,
    deleteStationInformation,
    bulkCreateStationInformation
} from '../controllers/stationInformation.controller';
import {
    authenticateToken,
    requireCapability,
    requireDepartmentMatchFromBody,
    requireStationDepartmentAccess
} from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Bulk create stations (Must be before general /:stationCode)
router.post('/bulk', requireCapability('create'), bulkCreateStationInformation);

// Create new station
router.post('/', requireCapability('create'), requireDepartmentMatchFromBody('stationTypeCode'), createStationInformation);

// Get all stations
router.get('/', requireCapability('view'), getAllStationInformation);

// Get station by code
router.get('/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getStationInformationByCode);

// Update station
router.put('/:stationCode', requireCapability('edit'), requireStationDepartmentAccess({ paramField: 'stationCode' }), updateStationInformation);

// Delete station
router.delete('/:stationCode', requireCapability('delete'), requireStationDepartmentAccess({ paramField: 'stationCode' }), deleteStationInformation);

export default router;
