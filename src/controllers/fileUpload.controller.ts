import { Response } from 'express';
import { AuthRequest } from '../types';
import path from 'path';
import { randomUUID } from 'crypto';
import { ensureSupabaseBucketExists, getSupabaseAdmin, SUPABASE_BUCKET_NAME } from '../config/supabase';
import { recordActivity } from '../utils/activity';

const sanitizeBaseName = (name: string): string => {
    const extension = path.extname(name);
    const baseName = path.basename(name, extension);
    return baseName.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60) || 'file';
};

export const uploadWorkflowFile = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
        }

        await ensureSupabaseBucketExists();
        const supabaseAdmin = getSupabaseAdmin();

        const extension = path.extname(file.originalname || '').toLowerCase();
        const safeBaseName = sanitizeBaseName(file.originalname || 'file');
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const objectPath = `workflow/${year}/${month}/${safeBaseName}-${Date.now()}-${randomUUID()}${extension}`;

        const { error: uploadError } = await supabaseAdmin
            .storage
            .from(SUPABASE_BUCKET_NAME)
            .upload(objectPath, file.buffer, {
                contentType: file.mimetype,
                upsert: false,
                cacheControl: '3600',
            });

        if (uploadError) {
            res.status(500).json({ error: 'File upload failed', details: uploadError.message });
            return;
        }

        const { data } = supabaseAdmin
            .storage
            .from(SUPABASE_BUCKET_NAME)
            .getPublicUrl(objectPath);

        const fileUrl = data.publicUrl;

        // Log activity
        const userId = req.user?.id;
        void recordActivity({
            actorId: userId,
            action: 'upload',
            entityType: 'file',
            entityId: `${objectPath}`,
            summary: `uploaded file: ${file.originalname || 'document'}`,
            metadata: {
                originalName: file.originalname,
                mimeType: file.mimetype,
                fileSize: file.size,
                storagePath: objectPath,
            },
            sourcePath: '/api/files/upload',
            requestMethod: 'POST',
        }).catch((err) => console.error('Activity log failed:', err));

        res.status(201).json({
            message: 'File uploaded successfully',
            data: {
                originalName: file.originalname,
                fileName: path.basename(objectPath),
                storagePath: objectPath,
                bucket: SUPABASE_BUCKET_NAME,
                mimeType: file.mimetype,
                size: file.size,
                url: fileUrl,
            },
        });
    } catch (error: any) {
        res.status(500).json({ error: 'File upload failed', details: error.message });
    }
};
