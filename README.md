# Property Survey Backend

A RESTful API backend built with **Node.js**, **Express.js**, and **Supabase (PostgreSQL)** for managing property surveys.

## Features

- 🔐 **JWT Authentication** — Register, login, and role-based access control
- 🏠 **Property Management** — Full CRUD for properties with filtering & pagination
- 📋 **Survey Management** — Create & manage surveys linked to properties
- ✅ **Input Validation** — Request validation with express-validator
- 🛡️ **Error Handling** — Global error handler with consistent JSON responses
- 📊 **Pagination** — Built-in page-based pagination on list endpoints

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** PostgreSQL (Supabase)
- **Auth:** JWT + bcryptjs
- **Validation:** express-validator

## Getting Started

### 1. Clone & Install

```bash
cd property-survey-backend
npm install
```

### 2. Configure Environment

Copy `.env` and fill in your Supabase credentials:

```env
PORT=5000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JWT_SECRET=your_secret_key
JWT_EXPIRE=7d
```

### 3. Set Up Database

Run the SQL in `database/schema.sql` in your **Supabase SQL Editor** to create all tables, indexes, and triggers.

### 4. Start the Server

```bash
# Development (with hot-reload)
npm run dev

# Production
npm start
```

## API Endpoints

### Health Check
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health check |

### Authentication
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | ❌ | Register a new user |
| POST | `/api/auth/login` | ❌ | Login and get JWT token |
| GET | `/api/auth/me` | ✅ | Get current user profile |

### Properties
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/properties` | ❌ | List all properties (paginated) |
| GET | `/api/properties/:id` | ❌ | Get property by ID |
| POST | `/api/properties` | ✅ | Create a new property |
| PUT | `/api/properties/:id` | ✅ | Update a property |
| DELETE | `/api/properties/:id` | ✅ | Delete a property |

### Surveys
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/surveys` | ❌ | List all surveys (paginated) |
| GET | `/api/surveys/:id` | ❌ | Get survey by ID |
| GET | `/api/surveys/property/:propertyId` | ❌ | Get surveys for a property |
| POST | `/api/surveys` | ✅ | Create a new survey |
| PUT | `/api/surveys/:id` | ✅ | Update a survey |
| DELETE | `/api/surveys/:id` | ✅ | Delete a survey |

## Project Structure

```
property-survey-backend/
├── config/
│   └── supabase.js          # Supabase client initialization
├── controllers/
│   ├── authController.js     # Auth logic (register, login, getMe)
│   ├── propertyController.js # Property CRUD logic
│   └── surveyController.js   # Survey CRUD logic
├── database/
│   └── schema.sql            # PostgreSQL schema for Supabase
├── middleware/
│   ├── auth.js               # JWT verification & role authorization
│   ├── errorHandler.js       # Global error handler & async wrapper
│   └── validate.js           # Express-validator result checker
├── routes/
│   ├── authRoutes.js         # /api/auth routes
│   ├── propertyRoutes.js     # /api/properties routes
│   └── surveyRoutes.js       # /api/surveys routes
├── .env                      # Environment variables
├── .gitignore
├── package.json
├── README.md
└── server.js                 # Express app entry point
```

## License

ISC
