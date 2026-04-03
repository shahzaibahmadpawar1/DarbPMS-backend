import { Router } from 'express';
import {
    createBuildingPermit, getAllBuildingPermits, getBuildingPermitsByStation, updateBuildingPermit, deleteBuildingPermit
} from '../controllers/buildingPermits.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireStationDepartmentAccess } from '../middleware/auth';

const buildingPermitDepartmentLookup = `
    SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
    FROM building_permits b
    INNER JOIN station_information si ON si.station_code = b.station_code
    WHERE b.id = $1
    LIMIT 1
`;

const router = Router();

router.use(authenticateToken);

router.post('/', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createBuildingPermit);
router.get('/', requireCapability('view'), getAllBuildingPermits);
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getBuildingPermitsByStation);
router.put('/:id', requireCapability('edit'), requireDepartmentAccessByLookup(buildingPermitDepartmentLookup, 'id'), updateBuildingPermit);
router.delete('/:id', requireCapability('delete'), requireDepartmentAccessByLookup(buildingPermitDepartmentLookup, 'id'), deleteBuildingPermit);

export default router;
