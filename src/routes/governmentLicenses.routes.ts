import { Router } from 'express';
import {
    createSalamahLicense, getAllSalamahLicenses, getSalamahLicensesByStation, updateSalamahLicense, deleteSalamahLicense,
    createTaqyeesLicense, getAllTaqyeesLicenses, getTaqyeesLicensesByStation, updateTaqyeesLicense, deleteTaqyeesLicense,
    createEnvironmentalLicense, getAllEnvironmentalLicenses, getEnvironmentalLicensesByStation, updateEnvironmentalLicense, deleteEnvironmentalLicense,
    getLatestSavedSalamahLicense, getLatestSavedTaqyeesLicense, getLatestSavedEnvironmentalLicense,
    upsertLicenseAttachments, getLicenseAttachmentsByStation,
} from '../controllers/governmentLicenses.controller';
import { authenticateToken, requireCapability, requireDepartmentAccessByLookup, requireStationDepartmentAccess } from '../middleware/auth';

const salamahDepartmentLookup = `
    SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
    FROM salamah_licenses s
    INNER JOIN station_information si ON si.station_code = s.station_code
    WHERE s.id = $1
    LIMIT 1
`;

const taqyeesDepartmentLookup = `
    SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
    FROM taqyees_licenses t
    INNER JOIN station_information si ON si.station_code = t.station_code
    WHERE t.id = $1
    LIMIT 1
`;

const environmentalDepartmentLookup = `
    SELECT (CASE WHEN lower(si.station_type_code) = 'frenchise' THEN 'franchise' ELSE lower(si.station_type_code) END) AS department
    FROM environmental_licenses e
    INNER JOIN station_information si ON si.station_code = e.station_code
    WHERE e.id = $1
    LIMIT 1
`;

const router = Router();
router.use(authenticateToken);

// Salamah
router.post('/salamah', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createSalamahLicense);
router.get('/salamah', requireCapability('view'), getAllSalamahLicenses);
router.get('/salamah/latest-saved', requireCapability('view'), getLatestSavedSalamahLicense);
router.get('/salamah/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getSalamahLicensesByStation);
router.put('/salamah/:id', requireCapability('edit'), requireDepartmentAccessByLookup(salamahDepartmentLookup, 'id'), updateSalamahLicense);
router.delete('/salamah/:id', requireCapability('delete'), requireDepartmentAccessByLookup(salamahDepartmentLookup, 'id'), deleteSalamahLicense);

// Taqyees
router.post('/taqyees', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createTaqyeesLicense);
router.get('/taqyees', requireCapability('view'), getAllTaqyeesLicenses);
router.get('/taqyees/latest-saved', requireCapability('view'), getLatestSavedTaqyeesLicense);
router.get('/taqyees/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getTaqyeesLicensesByStation);
router.put('/taqyees/:id', requireCapability('edit'), requireDepartmentAccessByLookup(taqyeesDepartmentLookup, 'id'), updateTaqyeesLicense);
router.delete('/taqyees/:id', requireCapability('delete'), requireDepartmentAccessByLookup(taqyeesDepartmentLookup, 'id'), deleteTaqyeesLicense);

// Environmental
router.post('/environmental', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), createEnvironmentalLicense);
router.get('/environmental', requireCapability('view'), getAllEnvironmentalLicenses);
router.get('/environmental/latest-saved', requireCapability('view'), getLatestSavedEnvironmentalLicense);
router.get('/environmental/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getEnvironmentalLicensesByStation);
router.put('/environmental/:id', requireCapability('edit'), requireDepartmentAccessByLookup(environmentalDepartmentLookup, 'id'), updateEnvironmentalLicense);
router.delete('/environmental/:id', requireCapability('delete'), requireDepartmentAccessByLookup(environmentalDepartmentLookup, 'id'), deleteEnvironmentalLicense);

// Attachments
router.post('/attachments', requireCapability('create'), requireStationDepartmentAccess({ bodyField: 'stationCode' }), upsertLicenseAttachments);
router.get('/attachments/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getLicenseAttachmentsByStation);

export default router;
