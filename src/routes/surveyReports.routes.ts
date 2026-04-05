import { Router } from 'express';
import { authenticateToken, requireCapability, requireStationDepartmentAccess } from '../middleware/auth';
import { getSurveyReportByStation, upsertSurveyReportByStation } from '../controllers/surveyReports.controller';

const router = Router();

router.use(authenticateToken);

router.get('/station/:stationCode', requireCapability('view'), requireStationDepartmentAccess({ paramField: 'stationCode' }), getSurveyReportByStation);
router.put('/station/:stationCode', requireCapability('edit'), requireStationDepartmentAccess({ paramField: 'stationCode' }), upsertSurveyReportByStation);

export default router;
