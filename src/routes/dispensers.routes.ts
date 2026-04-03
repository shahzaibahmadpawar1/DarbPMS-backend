import { Router } from 'express';
import { createDispenser, getAllDispensers, getDispenserBySerialNumber, updateDispenser, deleteDispenser, getDispensersByStation } from '../controllers/dispensers.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireStationDepartmentAccess } from '../middleware/auth';

const dispenserDepartmentLookup = `
	SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
	FROM dispensers d
	INNER JOIN station_information si ON si.station_code = d.station_code
	WHERE d.dispenser_serial_number = $1
	LIMIT 1
`;

const router = Router();
router.use(authenticateToken);

router.post('/', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createDispenser);
router.get('/', requireCapability('view'), getAllDispensers);
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getDispensersByStation);
router.get('/:serialNumber', requireCapability('view'), requireDepartmentAccessByLookup(dispenserDepartmentLookup, 'serialNumber'), getDispenserBySerialNumber);
router.put('/:serialNumber', requireCapability('edit'), requireDepartmentAccessByLookup(dispenserDepartmentLookup, 'serialNumber'), updateDispenser);
router.delete('/:serialNumber', requireCapability('delete'), requireDepartmentAccessByLookup(dispenserDepartmentLookup, 'serialNumber'), deleteDispenser);

export default router;
