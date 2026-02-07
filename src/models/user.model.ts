import pool from '../config/database';
import { User } from '../types';

export class UserModel {
    // Create a new user
    static async create(username: string, passwordHash: string): Promise<User> {
        const query = `
      INSERT INTO users (username, password_hash)
      VALUES ($1, $2)
      RETURNING id, username, password_hash, created_at, updated_at
    `;

        try {
            const result = await pool.query(query, [username, passwordHash]);
            return result.rows[0];
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
            return result.rows[0] || null;
        } catch (error) {
            throw error;
        }
    }

    // Find user by ID
    static async findById(id: string): Promise<User | null> {
        const query = 'SELECT * FROM users WHERE id = $1';

        try {
            const result = await pool.query(query, [id]);
            return result.rows[0] || null;
        } catch (error) {
            throw error;
        }
    }

    // Get all users (without password hashes)
    static async findAll(): Promise<Omit<User, 'password_hash'>[]> {
        const query = 'SELECT id, username, created_at, updated_at FROM users ORDER BY created_at DESC';

        try {
            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            throw error;
        }
    }
}
