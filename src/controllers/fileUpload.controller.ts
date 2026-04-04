import { Response } from 'express';
import { AuthRequest } from '../types';

export const uploadWorkflowFile = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const fileUrl = `${baseUrl}/uploads/${file.filename}`;

        res.status(201).json({
            message: 'File uploaded successfully',
            data: {
                originalName: file.originalname,
                fileName: file.filename,
                mimeType: file.mimetype,
                size: file.size,
                url: fileUrl,
            },
        });
    } catch (error: any) {
        res.status(500).json({ error: 'File upload failed', details: error.message });
    }
};
