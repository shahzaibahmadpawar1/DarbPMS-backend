import pool from '../config/database';
import { Department, User, UserRole } from '../types';
import { normalizeUserRole } from '../utils/roles';

function normalizeUserRow(row: any): User {
    return {
        ...row,
        role: normalizeUserRole(row.role),
    };
}

export class UserModel {
    // Create a new user
    static async create(
        username: string,
        password: string,
        role: UserRole = 'employee',
        department: Department | null = null,
        station_id: string | null = null
    ): Promise<User> {
        const query = `
      INSERT INTO users (username, password, role, department, station_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, password, role, department, station_id, created_at, updated_at
    `;

        try {
            const result = await pool.query(query, [username, password, role, department, station_id]);
            return normalizeUserRow(result.rows[0]);
        } catch (error: any) {
            // Handle unique constraint violation
            if (error.code === '23505') {
                throw new Error('Username already exists');
            }
            throw error;
        }
    }

    // Find user by username
    static async findByUsername(username: string): Promise<User | null> {
        const query = 'SELECT * FROM users WHERE username = $1';

        try {
            const result = await pool.query(query, [username]);
            return result.rows[0] ? normalizeUserRow(result.rows[0]) : null;
        } catch (error) {
            throw error;
        }
    }

    // Find user by ID
    static async findById(id: string): Promise<User | null> {
        const query = 'SELECT * FROM users WHERE id = $1';

        try {
            const result = await pool.query(query, [id]);
            return result.rows[0] ? normalizeUserRow(result.rows[0]) : null;
        } catch (error) {
            throw error;
        }
    }

    // Get all users (including password and role for admin view)
    static async findAll(): Promise<User[]> {
        const query = 'SELECT id, username, password, role, department, station_id, created_at, updated_at FROM users ORDER BY created_at DESC';

        try {
            const result = await pool.query(query);
            return result.rows.map(normalizeUserRow);
        } catch (error) {
            throw error;
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
