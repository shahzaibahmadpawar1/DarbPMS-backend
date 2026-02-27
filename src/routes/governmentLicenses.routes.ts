import { Router } from 'express';
import {
    createSalamahLicense, getAllSalamahLicenses, getSalamahLicensesByStation, updateSalamahLicense, deleteSalamahLicense,
    createTaqyeesLicense, getAllTaqyeesLicenses, getTaqyeesLicensesByStation, updateTaqyeesLicense, deleteTaqyeesLicense,
    createEnvironmentalLicense, getAllEnvironmentalLicenses, getEnvironmentalLicensesByStation, updateEnvironmentalLicense, deleteEnvironmentalLicense,
    upsertLicenseAttachments, getLicenseAttachmentsByStation,
} from '../controllers/governmentLicenses.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();
router.use(authenticateToken);

// Salamah
router.post('/salamah', createSalamahLicense);
router.get('/salamah', getAllSalamahLicenses);
router.get('/salamah/station/:stationCode', getSalamahLicensesByStation);
router.put('/salamah/:id', updateSalamahLicense);
router.delete('/salamah/:id', deleteSalamahLicense);

// Taqyees
router.post('/taqyees', createTaqyeesLicense);
router.get('/taqyees', getAllTaqyeesLicenses);
router.get('/taqyees/station/:stationCode', getTaqyeesLicensesByStation);
router.put('/taqyees/:id', updateTaqyeesLicense);
router.delete('/taqyees/:id', deleteTaqyeesLicense);

// Environmental
router.post('/environmental', createEnvironmentalLicense);
router.get('/environmental', getAllEnvironmentalLicenses);
router.get('/environmental/station/:stationCode', getEnvironmentalLicensesByStation);
router.put('/environmental/:id', updateEnvironmentalLicense);
router.delete('/environmental/:id', deleteEnvironmentalLicense);

// Attachments
router.post('/attachments', upsertLicenseAttachments);
router.get('/attachments/station/:stationCode', getLicenseAttachmentsByStation);

export default router;
