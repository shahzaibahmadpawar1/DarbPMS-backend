import { Router } from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { uploadWorkflowFile } from '../controllers/fileUpload.controller';
import { getAllowedMimeTypes, getMaxFileSizeMb } from '../config/supabase';

const allowedMimeTypes = new Set(getAllowedMimeTypes());
const maxFileSizeMb = getMaxFileSizeMb();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (!allowedMimeTypes.has(file.mimetype.toLowerCase())) {
            cb(new Error(`Unsupported file type: ${file.mimetype}`));
            return;
        }
        cb(null, true);
    },
});

const router = Router();
router.use(authenticateToken);

router.post('/upload', upload.single('file'), uploadWorkflowFile);

export default router;
