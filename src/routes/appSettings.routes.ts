import { Router } from 'express';
import { authenticateToken, requireSuperAdmin } from '../middleware/auth';
import { AppSettingsController } from '../controllers/appSettings.controller';

const router = Router();

router.use(authenticateToken);

router.get('/sidebar-nav-slots', AppSettingsController.getSidebarNavSlots);
router.put('/sidebar-nav-slots', requireSuperAdmin, AppSettingsController.putSidebarNavSlots);

router.get('/survey-dropdowns', AppSettingsController.getSurveyDropdowns);
router.put('/survey-dropdowns', requireSuperAdmin, AppSettingsController.putSurveyDropdowns);

export default router;
