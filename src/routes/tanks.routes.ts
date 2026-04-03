import { Router } from 'express';
import { createTank, getAllTanks, getTankByCode, updateTank, deleteTank, getTanksByStation } from '../controllers/tanks.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireStationDepartmentAccess } from '../middleware/auth';

const tankDepartmentLookup = `
	SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
	FROM tanks t
	INNER JOIN station_information si ON si.station_code = t.station_code
	WHERE t.tank_code = $1
	LIMIT 1
`;

const router = Router();
router.use(authenticateToken);

router.post('/', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createTank);
router.get('/', requireCapability('view'), getAllTanks);
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getTanksByStation);
router.get('/:tankCode', requireCapability('view'), requireDepartmentAccessByLookup(tankDepartmentLookup, 'tankCode'), getTankByCode);
router.put('/:tankCode', requireCapability('edit'), requireDepartmentAccessByLookup(tankDepartmentLookup, 'tankCode'), updateTank);
router.delete('/:tankCode', requireCapability('delete'), requireDepartmentAccessByLookup(tankDepartmentLookup, 'tankCode'), deleteTank);

export default router;
