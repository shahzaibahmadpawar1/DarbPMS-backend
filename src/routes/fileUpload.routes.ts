import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken } from '../middleware/auth';
import { uploadWorkflowFile } from '../controllers/fileUpload.controller';

const uploadDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const extension = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, extension).replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 50);
        const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        cb(null, `${baseName}-${uniquePart}${extension}`);
    },
});

const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

const router = Router();
router.use(authenticateToken);

router.post('/upload', upload.single('file'), uploadWorkflowFile);

export default router;
