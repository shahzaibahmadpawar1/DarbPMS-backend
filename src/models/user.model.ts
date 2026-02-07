import pool from '../config/database';
import { User } from '../types';

export class UserModel {
    // Create a new user
    static async create(username: string, password: string): Promise<User> {
        const query = `
      INSERT INTO users (username, password)
      VALUES (?, ?)
    `;

        try {
            const [result]: any = await pool.query(query, [username, password]);
            // Fetch the created user
            const [rows]: any = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
            return rows[0];
        } catch (error: any) {
            // Handle unique constraint violation (MySQL error code)
            if (error.code === 'ER_DUP_ENTRY') {
                throw new Error('Username already exists');
            }
            throw error;
        }
    }

    // Find user by username
    static async findByUsername(username: string): Promise<User | null> {
        const query = 'SELECT * FROM users WHERE username = ?';

        try {
            const [rows]: any = await pool.query(query, [username]);
            return rows[0] || null;
        } catch (error) {
            throw error;
        }
    }

    // Find user by ID
    static async findById(id: string): Promise<User | null> {
        const query = 'SELECT * FROM users WHERE id = ?';

        try {
            const [rows]: any = await pool.query(query, [id]);
            return rows[0] || null;
        } catch (error) {
            throw error;
        }
    }

    // Get all users (without password hashes)
    static async findAll(): Promise<Omit<User, 'password'>[]> {
        const query = 'SELECT id, username, created_at, updated_at FROM users ORDER BY created_at DESC';

        try {
            const [rows]: any = await pool.query(query);
            return rows;
        } catch (error) {
            throw error;
        }
    }
}
