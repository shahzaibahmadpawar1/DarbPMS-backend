import { Router } from 'express';
import {
    createDeed, getAllDeeds, getDeedsByStation, updateDeed, deleteDeed
} from '../controllers/deeds.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireStationDepartmentAccess } from '../middleware/auth';

const deedDepartmentLookup = `
    SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
    FROM deeds d
    INNER JOIN station_information si ON si.station_code = d.station_code
    WHERE d.id = $1
    LIMIT 1
`;

const router = Router();

router.use(authenticateToken);

router.post('/', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createDeed);
router.get('/', requireCapability('view'), getAllDeeds);
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getDeedsByStation);
router.put('/:id', requireCapability('edit'), requireDepartmentAccessByLookup(deedDepartmentLookup, 'id'), updateDeed);
router.delete('/:id', requireCapability('delete'), requireDepartmentAccessByLookup(deedDepartmentLookup, 'id'), deleteDeed);

export default router;
