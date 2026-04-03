import { Router } from 'express';
import { createNozzle, getAllNozzles, getNozzleBySerialNumber, updateNozzle, deleteNozzle, getNozzlesByDispenser } from '../controllers/nozzles.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup } from '../middleware/auth';

const nozzleDepartmentLookup = `
	SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
	FROM nozzles n
	INNER JOIN dispensers d ON d.dispenser_serial_number = n.dispenser_serial_number
	INNER JOIN station_information si ON si.station_code = d.station_code
	WHERE n.nozzle_serial_number = $1
	LIMIT 1
`;

const dispenserDepartmentLookup = `
	SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
	FROM dispensers d
	INNER JOIN station_information si ON si.station_code = d.station_code
	WHERE d.dispenser_serial_number = $1
	LIMIT 1
`;

const router = Router();
router.use(authenticateToken);

router.post('/', requireCapability('create'), createNozzle);
router.get('/', requireCapability('view'), getAllNozzles);
router.get('/dispenser/:dispenserSerialNumber', requireCapability('view'), requireDepartmentAccessByLookup(dispenserDepartmentLookup, 'dispenserSerialNumber'), getNozzlesByDispenser);
router.get('/:serialNumber', requireCapability('view'), requireDepartmentAccessByLookup(nozzleDepartmentLookup, 'serialNumber'), getNozzleBySerialNumber);
router.put('/:serialNumber', requireCapability('edit'), requireDepartmentAccessByLookup(nozzleDepartmentLookup, 'serialNumber'), updateNozzle);
router.delete('/:serialNumber', requireCapability('delete'), requireDepartmentAccessByLookup(nozzleDepartmentLookup, 'serialNumber'), deleteNozzle);

export default router;
