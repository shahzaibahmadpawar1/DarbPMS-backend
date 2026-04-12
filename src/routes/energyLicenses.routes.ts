import { Router } from 'express';
import {
    createEnergyLicense,
    getAllEnergyLicenses,
    getEnergyLicensesByStation,
    updateEnergyLicense,
    deleteEnergyLicense,
    getLatestSavedEnergyLicense,
} from '../controllers/energyLicenses.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireStationDepartmentAccess } from '../middleware/auth';

const energyLicenseDepartmentLookup = `
    SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
    FROM energy_licenses e
    INNER JOIN station_information si ON si.station_code = e.station_code
    WHERE e.id = $1
    LIMIT 1
`;

const router = Router();
router.use(authenticateToken);

router.post('/', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createEnergyLicense);
router.get('/', requireCapability('view'), getAllEnergyLicenses);
router.get('/latest-saved', requireCapability('view'), getLatestSavedEnergyLicense);
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getEnergyLicensesByStation);
router.put('/:id', requireCapability('edit'), requireDepartmentAccessByLookup(energyLicenseDepartmentLookup, 'id'), updateEnergyLicense);
router.delete('/:id', requireCapability('delete'), requireDepartmentAccessByLookup(energyLicenseDepartmentLookup, 'id'), deleteEnergyLicense);

export default router;
