import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticateToken } from '../middleware/auth';
import { uploadWorkflowFile } from '../controllers/fileUpload.controller';
import { getAllowedFileExtensions, getAllowedMimeTypes, getMaxFileSizeMb } from '../config/supabase';

const allowedMimeTypes = new Set(getAllowedMimeTypes());
const allowedExtensions = new Set(getAllowedFileExtensions());
const maxFileSizeMb = getMaxFileSizeMb();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const mime = (file.mimetype || '').toLowerCase();
        const extension = path.extname(file.originalname || '').toLowerCase();
        const mimeAllowed = mime ? allowedMimeTypes.has(mime) : false;
        const extensionAllowed = extension ? allowedExtensions.has(extension) : false;

        if (!mimeAllowed && !extensionAllowed) {
            cb(new Error(`Unsupported file type: ${file.mimetype || extension || 'unknown'}`));
            return;
        }

        cb(null, true);
    },
});

const router = Router();
router.use(authenticateToken);

router.post('/upload', upload.single('file'), uploadWorkflowFile);

export default router;