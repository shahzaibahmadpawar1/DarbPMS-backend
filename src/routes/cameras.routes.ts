import { Router } from 'express';
import {
    createCamera,
    getAllCameras,
    getCameraBySerialNumber,
    updateCamera,
    deleteCamera,
    getCamerasByStation,
    getLatestSavedCamera,
} from '../controllers/cameras.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireStationDepartmentAccess } from '../middleware/auth';

const cameraDepartmentLookup = `
    SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
    FROM cameras c
    INNER JOIN station_information si ON si.station_code = c.station_code
    WHERE c.serial_number = $1
    LIMIT 1
`;

const router = Router();

router.use(authenticateToken);

router.post('/', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createCamera);
router.get('/', requireCapability('view'), getAllCameras);
router.get('/latest-saved', requireCapability('view'), getLatestSavedCamera);
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getCamerasByStation);
router.get('/:serialNumber', requireCapability('view'), requireDepartmentAccessByLookup(cameraDepartmentLookup, 'serialNumber'), getCameraBySerialNumber);
router.put('/:serialNumber', requireCapability('edit'), requireDepartmentAccessByLookup(cameraDepartmentLookup, 'serialNumber'), updateCamera);
router.delete('/:serialNumber', requireCapability('delete'), requireDepartmentAccessByLookup(cameraDepartmentLookup, 'serialNumber'), deleteCamera);

export default router;
