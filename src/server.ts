import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import pool from './config/database';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// CORS configuration - allow multiple origins
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://stg.pms.darbstations.com.sa',
    process.env.CORS_ORIGIN
].filter(Boolean); // Remove undefined values

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', async (_req: Request, res: Response) => {
    try {
        // Test database connection
        await pool.query('SELECT 1');
        res.status(200).json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected'
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: 'disconnected'
        });
    }
});

// Root route - API information
app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        message: 'DARB PMS Backend API',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login',
                profile: 'GET /api/auth/profile (requires auth)'
            }
        },
        documentation: 'https://github.com/your-repo/docs'
    });
});

// API routes
app.use('/api/auth', authRoutes);

// 404 handler
app.use((_req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start server only if not in Vercel serverless environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log('=================================');
        console.log('🚀 DARB Backend Server Started');
        console.log('=================================');
        console.log(`📍 Server running on port ${PORT}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 CORS enabled for: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
        console.log('=================================');
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('SIGTERM signal received: closing HTTP server');
        await pool.end();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        console.log('SIGINT signal received: closing HTTP server');
        await pool.end();
        process.exit(0);
    });
}

export default app;
