Himalayan Backend
=================

Minimal Express + MongoDB backend for the Himalayan Fresh app.

Quick start
-----------

1. Copy `.env.example` to `.env` and set `MONGO_URI` (your MongoDB connection string):

```bash
cp backend/.env.example backend/.env
# edit backend/.env and set MONGO_URI
```

You can use the connection string you provided (NOT recommended for production):

```
MONGO_URI=mongodb+srv://admin:admin@cluster0.10mbee3.mongodb.net/?appName=Cluster0
```

2. Install dependencies and start the server:

```bash
cd backend
npm install
npm run dev    # requires nodemon
# or
npm start
```

API endpoints (JSON)
--------------------

Addresses
- GET  /api/addresses?userId=...        list addresses for user
- POST /api/addresses                  create address
- PUT  /api/addresses/:id              update address
- DELETE /api/addresses/:id            delete address
- PATCH /api/addresses/:id/default     set address as default

Subscriptions
- GET  /api/subscriptions?userId=...   list subscriptions
- POST /api/subscriptions              create subscription
- PUT  /api/subscriptions/:id          update subscription
- DELETE /api/subscriptions/:id        delete subscription

Notes
-----
- This is intentionally minimal. You should add authentication, validation, and rate limiting for production.
- The models include a `userId` field; the frontend can send a user identifier as needed.
