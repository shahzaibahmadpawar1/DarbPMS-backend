import { Router } from 'express';
import {
    createOwner, getAllOwners, getOwnersByStation, updateOwner, deleteOwner
} from '../controllers/owners.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireStationDepartmentAccess } from '../middleware/auth';

const ownerDepartmentLookup = `
    SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
    FROM owners o
    INNER JOIN station_information si ON si.station_code = o.station_code
    WHERE o.id = $1
    LIMIT 1
`;

const router = Router();

router.use(authenticateToken);

router.post('/', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createOwner);
router.get('/', requireCapability('view'), getAllOwners);
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getOwnersByStation);
router.put('/:id', requireCapability('edit'), requireDepartmentAccessByLookup(ownerDepartmentLookup, 'id'), updateOwner);
router.delete('/:id', requireCapability('delete'), requireDepartmentAccessByLookup(ownerDepartmentLookup, 'id'), deleteOwner);

export default router;
