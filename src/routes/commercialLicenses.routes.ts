import { Router } from 'express';
import {
    createCommercialLicense, getAllCommercialLicenses, getCommercialLicensesByStation, updateCommercialLicense, deleteCommercialLicense
} from '../controllers/commercialLicenses.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.post('/', createCommercialLicense);
router.get('/', getAllCommercialLicenses);
router.get('/station/:stationCode', getCommercialLicensesByStation);
router.put('/:id', updateCommercialLicense);
router.delete('/:id', deleteCommercialLicense);

export default router;
