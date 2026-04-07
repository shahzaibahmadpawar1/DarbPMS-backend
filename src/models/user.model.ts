import pool from '../config/database';
import { Department, User, UserRole, UserStatus, UserType } from '../types';
import { normalizeUserRole } from '../utils/roles';

function normalizeUserRow(row: any): User {
    return {
        ...row,
        role: normalizeUserRole(row.role),
        user_type: row.user_type === 'external' ? 'external' : 'internal',
        status: row.status === 'inactive' ? 'inactive' : 'active',
        station_codes: Array.isArray(row.station_codes) ? row.station_codes : [],
    };
}

export class UserModel {
    // Create a new user
    static async create(
        username: string,
        password: string,
        role: UserRole = 'employee',
        department: Department | null = null,
        station_id: string | null = null,
        full_name: string | null = null,
        email: string | null = null,
        phone: string | null = null,
        user_type: UserType = 'internal',
        status: UserStatus = 'active',
        station_codes: string[] = []
    ): Promise<User> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const insertUserQuery = `
                INSERT INTO users (username, password, role, department, station_id, full_name, email, phone, user_type, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id, username, password, role, department, station_id, full_name, email, phone, user_type, status, created_at, updated_at
            `;

            const userResult = await client.query(insertUserQuery, [
                username,
                password,
                role,
                department,
                station_id,
                full_name,
                email,
                phone,
                user_type,
                status,
            ]);

            const createdUser = userResult.rows[0];

            const normalizedCodes = Array.from(
                new Set(
                    station_codes
                        .map((code) => String(code || '').trim())
                        .filter((code) => code.length > 0)
                )
            );

            if (user_type === 'external' && normalizedCodes.length > 0) {
                await client.query(
                    `
                        INSERT INTO user_station_access (user_id, station_code)
                        SELECT $1, unnest($2::text[])
                    `,
                    [createdUser.id, normalizedCodes]
                );
            }

            await client.query('COMMIT');

            const stationCodes = await this.getStationCodesByUserId(createdUser.id);
            return normalizeUserRow({ ...createdUser, station_codes: stationCodes });
        } catch (error: any) {
            await client.query('ROLLBACK');
            // Handle unique constraint violation
            if (error.code === '23505') {
                throw new Error('Username already exists');
            }
            throw error;
        } finally {
            client.release();
        }
    }

    // Find user by username
    static async findByUsername(username: string): Promise<User | null> {
        const query = `
            SELECT id, username, password, role, department, station_id, full_name, email, phone, user_type, status, created_at, updated_at
            FROM users
            WHERE username = $1
        `;

        try {
            const result = await pool.query(query, [username]);
            if (!result.rows[0]) {
                return null;
            }

            const stationCodes = await this.getStationCodesByUserId(result.rows[0].id);
            return normalizeUserRow({ ...result.rows[0], station_codes: stationCodes });
        } catch (error) {
            throw error;
        }
    }

    static async findActiveByUsername(username: string): Promise<User | null> {
        const query = `
            SELECT id, username, password, role, department, station_id, full_name, email, phone, user_type, status, created_at, updated_at
            FROM users
            WHERE username = $1 AND status = 'active'
        `;

        try {
            const result = await pool.query(query, [username]);
            if (!result.rows[0]) {
                return null;
            }

            const stationCodes = await this.getStationCodesByUserId(result.rows[0].id);
            return normalizeUserRow({ ...result.rows[0], station_codes: stationCodes });
        } catch (error) {
            throw error;
        }
    }

    // Find user by ID
    static async findById(id: string): Promise<User | null> {
        const query = `
            SELECT id, username, password, role, department, station_id, full_name, email, phone, user_type, status, created_at, updated_at
            FROM users
            WHERE id = $1
        `;

        try {
            const result = await pool.query(query, [id]);
            if (!result.rows[0]) {
                return null;
            }

            const stationCodes = await this.getStationCodesByUserId(id);
            return normalizeUserRow({ ...result.rows[0], station_codes: stationCodes });
        } catch (error) {
            throw error;
        }
    }

    // Get all users (including password and role for admin view)
    static async findAll(): Promise<User[]> {
        const query = `
            SELECT
                u.id,
                u.username,
                u.password,
                u.role,
                u.department,
                u.station_id,
                u.full_name,
                u.email,
                u.phone,
                u.user_type,
                u.status,
                u.created_at,
                u.updated_at,
                COALESCE(array_agg(usa.station_code) FILTER (WHERE usa.station_code IS NOT NULL), '{}') AS station_codes
            FROM users u
            LEFT JOIN user_station_access usa ON usa.user_id = u.id
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `;

        try {
            const result = await pool.query(query);
            return result.rows.map(normalizeUserRow);
        } catch (error) {
            throw error;
        }
    }

    static async updateStatus(id: string, status: UserStatus): Promise<User | null> {
        const query = `
            UPDATE users
            SET status = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING id, username, password, role, department, station_id, full_name, email, phone, user_type, status, created_at, updated_at
        `;

        try {
            const result = await pool.query(query, [id, status]);
            if (!result.rows[0]) {
                return null;
            }

            const stationCodes = await this.getStationCodesByUserId(id);
            return normalizeUserRow({ ...result.rows[0], station_codes: stationCodes });
        } catch (error) {
            throw error;
        }
    }

    static async getStationCodesByUserId(userId: string): Promise<string[]> {
        const query = `
            SELECT station_code
            FROM user_station_access
            WHERE user_id = $1
            ORDER BY station_code ASC
        `;

        try {
            const result = await pool.query(query, [userId]);
            return result.rows.map((row: any) => row.station_code);
        } catch {
            return [];
        }
    }

    // Delete user by ID
    static async deleteById(id: string): Promise<boolean> {
        const query = 'DELETE FROM users WHERE id = $1 RETURNING id';

        try {
            const result = await pool.query(query, [id]);
            return (result.rowCount ?? 0) > 0;
        } catch (error) {
            throw error;
        }
    }
}
