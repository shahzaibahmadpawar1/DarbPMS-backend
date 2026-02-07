# DARB Backend API

Backend API for DARB Project Management System built with Node.js, Express, TypeScript, and PostgreSQL.

## Features

- ✅ User authentication with JWT
- ✅ Password hashing with bcrypt
- ✅ PostgreSQL database with connection pooling
- ✅ TypeScript for type safety
- ✅ CORS enabled for frontend integration
- ✅ Environment-based configuration
- ✅ Error handling and request logging

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **PostgreSQL** (v14 or higher) - [Download](https://www.postgresql.org/download/)
- **npm** or **yarn** package manager

## Installation

### 1. Clone and Navigate

```bash
cd "DARB Phase 1 Backend"
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up PostgreSQL Database

#### Create Database

Open PostgreSQL command line (psql) or use pgAdmin:

```sql
CREATE DATABASE darb_pms;
```

#### Run Schema

Navigate to the database directory and run the schema file:

```bash
psql -U postgres -d darb_pms -f database/schema.sql
```

Or copy the contents of `database/schema.sql` and execute in your PostgreSQL client.

### 4. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and update with your configuration:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=darb_pms
DB_USER=postgres
DB_PASSWORD=your_actual_password

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
JWT_EXPIRES_IN=24h

# CORS Configuration
CORS_ORIGIN=http://localhost:5173
```

**Important:** Change `JWT_SECRET` to a strong random string in production!

### 5. Test Database Connection

```bash
npm run test:db
```

You should see:
```
✓ Database connection successful!
✓ Users table exists
✓ Current user count: 0
```

## Running the Server

### Development Mode (with auto-reload)

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

The server will start on `http://localhost:5000` (or your configured PORT).

## API Endpoints

### Health Check

**GET** `/health`

Check if the server and database are running.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-07T00:00:00.000Z",
  "database": "connected"
}
```

---

### Authentication Endpoints

Base URL: `/api/auth`

#### 1. Register User

**POST** `/api/auth/register`

Register a new user account.

**Request Body:**
```json
{
  "username": "john_doe",
  "password": "securePassword123"
}
```

**Validation:**
- Username: 3-50 characters
- Password: minimum 6 characters

**Success Response (201):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "john_doe",
    "created_at": "2026-02-07T00:00:00.000Z",
    "updated_at": "2026-02-07T00:00:00.000Z"
  }
}
```

**Error Response (409):**
```json
{
  "success": false,
  "message": "Username already exists"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"john_doe","password":"securePassword123"}'
```

---

#### 2. Login

**POST** `/api/auth/login`

Authenticate and receive a JWT token.

**Request Body:**
```json
{
  "username": "john_doe",
  "password": "securePassword123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "john_doe",
    "created_at": "2026-02-07T00:00:00.000Z",
    "updated_at": "2026-02-07T00:00:00.000Z"
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "message": "Invalid username or password"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"john_doe","password":"securePassword123"}'
```

---

#### 3. Get Profile (Protected)

**GET** `/api/auth/profile`

Get the current user's profile. Requires authentication.

**Headers:**
```
Authorization: Bearer <your_jwt_token>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile retrieved successfully",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "john_doe",
    "created_at": "2026-02-07T00:00:00.000Z",
    "updated_at": "2026-02-07T00:00:00.000Z"
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "message": "Access token is required"
}
```

**cURL Example:**
```bash
curl -X GET http://localhost:5000/api/auth/profile \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Testing the API

### Using cURL

1. **Register a user:**
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123456"}'
```

2. **Login (save the token):**
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"test123456"}'
```

3. **Get profile (use token from login):**
```bash
curl -X GET http://localhost:5000/api/auth/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Using Postman

1. Import the endpoints into Postman
2. Create a new environment with variable `baseUrl` = `http://localhost:5000`
3. Test each endpoint
4. Save the token from login response and use it in the Authorization header

## Project Structure

```
DARB Phase 1 Backend/
├── src/
│   ├── config/
│   │   └── database.ts          # PostgreSQL connection pool
│   ├── middleware/
│   │   └── auth.ts               # JWT authentication middleware
│   ├── routes/
│   │   └── auth.routes.ts        # Authentication routes
│   ├── controllers/
│   │   └── auth.controller.ts    # Authentication logic
│   ├── models/
│   │   └── user.model.ts         # User database operations
│   ├── types/
│   │   └── index.ts              # TypeScript type definitions
│   ├── server.ts                 # Main server entry point
│   └── test-db-connection.ts     # Database connection test
├── database/
│   └── schema.sql                # PostgreSQL schema
├── .env                          # Environment variables (create from .env.example)
├── .env.example                  # Environment template
├── .gitignore                    # Git ignore rules
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # This file
```

## Database Schema

### Users Table

| Column        | Type                     | Description                    |
|---------------|--------------------------|--------------------------------|
| id            | UUID                     | Primary key (auto-generated)   |
| username      | VARCHAR(50)              | Unique username                |
| password_hash | VARCHAR(255)             | Bcrypt hashed password         |
| created_at    | TIMESTAMP WITH TIME ZONE | Account creation timestamp     |
| updated_at    | TIMESTAMP WITH TIME ZONE | Last update timestamp          |

**Indexes:**
- `idx_users_username` on `username` for fast lookups

**Triggers:**
- Auto-update `updated_at` on record modification

## Security Features

- **Password Hashing:** All passwords are hashed using bcrypt with 10 salt rounds
- **JWT Authentication:** Secure token-based authentication
- **SQL Injection Protection:** Parameterized queries using pg library
- **CORS:** Configured to allow requests only from specified origins
- **Environment Variables:** Sensitive data stored in environment variables

## Frontend Integration

To integrate with the React frontend:

1. Update the frontend to call these API endpoints
2. Store the JWT token in localStorage or a secure cookie
3. Include the token in the Authorization header for protected routes

Example frontend code:

```typescript
// Login function
const login = async (username: string, password: string) => {
  const response = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  
  const data = await response.json();
  if (data.success) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
  }
  return data;
};

// Protected API call
const getProfile = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('http://localhost:5000/api/auth/profile', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
};
```

## Troubleshooting

### Database Connection Issues

**Error:** `Connection refused`
- Ensure PostgreSQL is running
- Check DB_HOST and DB_PORT in .env
- Verify PostgreSQL is accepting connections

**Error:** `password authentication failed`
- Check DB_USER and DB_PASSWORD in .env
- Ensure the PostgreSQL user has access to the database

### JWT Issues

**Error:** `JWT_SECRET is not defined`
- Ensure JWT_SECRET is set in .env file
- Restart the server after updating .env

### CORS Issues

**Error:** `CORS policy: No 'Access-Control-Allow-Origin' header`
- Update CORS_ORIGIN in .env to match your frontend URL
- Restart the server

## Next Steps

1. **Add More User Fields:** Extend the users table with email, role, profile picture, etc.
2. **Password Reset:** Implement forgot password functionality
3. **Email Verification:** Add email verification for new accounts
4. **Refresh Tokens:** Implement refresh token mechanism for better security
5. **Rate Limiting:** Add rate limiting to prevent brute force attacks
6. **Logging:** Implement proper logging with Winston or similar
7. **Testing:** Add unit and integration tests with Jest
8. **API Documentation:** Generate API docs with Swagger/OpenAPI

## License

ISC

## Support

For issues or questions, please contact the DARB development team.
