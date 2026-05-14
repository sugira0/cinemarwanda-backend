# CINEMA Rwanda Backend API

Core backend API server for the CINEMA Rwanda streaming platform. This is the active production backend serving all client applications (web, mobile, admin portal).

## Overview

- **Framework**: Express.js with Node.js
- **Database**: MongoDB
- **Media Storage**: Cloudinary
- **Authentication**: Firebase with OTP
- **Deployment**: Vercel
- **API Base URL**: `https://cinemarwanda-backend.vercel.app`

## Features

- **Authentication & Authorization**: User registration, login, OTP verification
- **Content Management**: Movie upload, metadata management, streaming support
- **User Management**: User profiles, subscriptions, device tracking
- **Payment Processing**: Subscription management, payment transactions
- **Analytics**: User activity tracking, platform metrics
- **Notifications**: Push notifications, OTP delivery via WhatsApp/Email
- **Comments & Ratings**: User reviews and ratings for movies
- **Watchlist**: User watchlist management
- **Device Management**: Track user devices and manage access

## Setup

### Prerequisites

- Node.js 16+
- npm or yarn
- MongoDB instance
- Cloudinary account
- Firebase project

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```bash
# Database
MONGODB_URI=your_mongodb_connection_string

# Cloudinary (Media Storage)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_FOLDER=cinema-rwanda
CLOUDINARY_VIDEO_CHUNK_SIZE=10000000
MEDIA_BACKEND=cloudinary

# Firebase
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY=your_private_key
FIREBASE_CLIENT_EMAIL=your_client_email

# Email/Communication
MAILER_EMAIL=your_email@gmail.com
MAILER_PASSWORD=your_app_password
WHATSAPP_API_KEY=your_whatsapp_api_key
WHATSAPP_PHONE_ID=your_phone_id

# Authentication
JWT_SECRET=your_jwt_secret
JWT_EXPIRE=7d

# Server
PORT=3000
NODE_ENV=production
```

## Running Locally

```bash
# Development
npm run dev

# Production
npm start
```

The API will be available at `http://localhost:3000`

## Project Structure

```
cinemarwanda-backend/
├── api/           # API routes (catch-all for Vercel)
├── routes/        # Route handlers
├── models/        # MongoDB models
├── middleware/    # Express middleware
├── utils/         # Utility functions
├── app.js         # Express app configuration
├── db.js          # Database connection
└── server.js      # Server entry point
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/verify-otp` - Verify OTP

### Movies
- `GET /api/movies` - Get all movies
- `GET /api/movies/:id` - Get movie details
- `POST /api/movies` - Create movie (admin)
- `PUT /api/movies/:id` - Update movie (admin)
- `DELETE /api/movies/:id` - Delete movie (admin)

### Users
- `GET /api/users` - Get user profile
- `PATCH /api/users` - Update user profile
- `GET /api/users/devices/activity` - Get device activity
- `POST /api/users/broadcast` - Send broadcast (admin)

### Payments
- `GET /api/payments` - Get payment history
- `POST /api/payments` - Create payment

### Comments
- `GET /api/comments/:movieId` - Get movie comments
- `POST /api/comments` - Add comment
- `DELETE /api/comments/:id` - Delete comment

### Watchlist
- `GET /api/watchlist` - Get user watchlist
- `POST /api/watchlist` - Add to watchlist
- `DELETE /api/watchlist/:movieId` - Remove from watchlist

### Analytics
- `GET /api/analytics` - Get platform analytics (admin)

### Notifications
- `GET /api/notifications` - Get user notifications
- `POST /api/notifications` - Send notification (admin)

## Deployment

Deployed on Vercel. Push to main branch triggers automatic deployment.

```bash
vercel deploy
```

## Database

The backend uses MongoDB with the following models:
- **User**: User accounts and profiles
- **Movie**: Movie metadata and streaming info
- **Stream**: Streaming sessions
- **Payment**: Payment transactions
- **Comment**: User comments and ratings
- **Notification**: User notifications
- **AuthOtp**: OTP verification records
- **Actor**: Actor/cast information

## Media Storage

All media (posters, trailers, videos) is stored on Cloudinary with optimized delivery.

## Security

- JWT-based authentication
- Role-based access control (User, Admin)
- OTP verification for sensitive operations
- CORS configuration for authorized domains
- Environment variables for sensitive data

## Debugging

Enable debug logs by setting `DEBUG=cinema-rwanda:*`

## Note

There is an older monorepo at `../rwandan-movies` with its own server folder. This is kept for reference only. Use this folder for all production changes unless intentionally migrating back to the monorepo structure.
