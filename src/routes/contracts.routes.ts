import { Router } from 'express';
import {
    createContract, getAllContracts, getContractsByStation, updateContract, deleteContract
} from '../controllers/contracts.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireStationDepartmentAccess } from '../middleware/auth';

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
router.get('/', requireCapability('view'), getAllContracts);
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getContractsByStation);
router.put('/:id', requireCapability('edit'), requireDepartmentAccessByLookup(contractDepartmentLookup, 'id'), updateContract);
router.delete('/:id', requireCapability('delete'), requireDepartmentAccessByLookup(contractDepartmentLookup, 'id'), deleteContract);

export default router;
