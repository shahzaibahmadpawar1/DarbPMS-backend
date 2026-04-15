import { Router } from 'express';
import {
    createContract,
    createOrGetContractDraftFromTask,
    deleteContract,
    getAllContracts,
    getContractsByStation,
    getLatestSavedContract,
    reviewContract,
    updateContract,
} from '../controllers/contracts.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireStationDepartmentAccess, requireSuperAdmin } from '../middleware/auth';

const contractDepartmentLookup = `
    SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
    FROM contracts c
    INNER JOIN station_information si ON si.station_code = c.station_code
    WHERE c.id = $1
    LIMIT 1
`;

const router = Router();

router.use(authenticateToken);

router.post('/', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createContract);
router.post('/from-task/:taskId', requireCapability('view'), createOrGetContractDraftFromTask);
router.get('/', requireCapability('view'), getAllContracts);
router.get('/latest-saved', requireCapability('view'), getLatestSavedContract);
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getContractsByStation);
router.put('/:id', requireCapability('edit'), requireDepartmentAccessByLookup(contractDepartmentLookup, 'id'), updateContract);
router.patch('/:id/review', requireSuperAdmin, reviewContract);
router.delete('/:id', requireCapability('delete'), requireDepartmentAccessByLookup(contractDepartmentLookup, 'id'), deleteContract);

export default router;
