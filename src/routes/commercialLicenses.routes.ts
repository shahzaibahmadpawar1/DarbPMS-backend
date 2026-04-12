import { Router } from 'express';
import {
    createCommercialLicense, getAllCommercialLicenses, getCommercialLicensesByStation, updateCommercialLicense, deleteCommercialLicense, getLatestSavedCommercialLicense
} from '../controllers/commercialLicenses.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireStationDepartmentAccess } from '../middleware/auth';

const commercialLicenseDepartmentLookup = `
    SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
    FROM commercial_licenses c
    INNER JOIN station_information si ON si.station_code = c.station_code
    WHERE c.id = $1
    LIMIT 1
`;

const router = Router();

router.use(authenticateToken);

router.post('/', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createCommercialLicense);
router.get('/', requireCapability('view'), getAllCommercialLicenses);
router.get('/latest-saved', requireCapability('view'), getLatestSavedCommercialLicense);
router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getCommercialLicensesByStation);
router.put('/:id', requireCapability('edit'), requireDepartmentAccessByLookup(commercialLicenseDepartmentLookup, 'id'), updateCommercialLicense);
router.delete('/:id', requireCapability('delete'), requireDepartmentAccessByLookup(commercialLicenseDepartmentLookup, 'id'), deleteCommercialLicense);

export default router;
