# Masala House — Full-stack deployable starter

This is a real multi-file Node.js/Express e-commerce application, not a single HTML mockup.

## Stack
- Node.js 20
- Express
- SQLite + better-sqlite3
- Vanilla JS/CSS frontend
- Admin authentication with JWT + bcrypt
- Rate limiting, Helmet, compression
- Optional Razorpay order creation
- REST API for products and orders

## Run locally
1. Install Node.js 20+
2. Copy `.env.example` to `.env`
3. Change `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`
4. Run `npm install`
5. Run `npm start`
6. Open `http://localhost:3000`
7. Admin: `http://localhost:3000/admin.html`

The database is created automatically in `data/masala-house.db` and the 50 products are seeded on first start.

## Production setup
Set real values for:
- store contact details
- product prices/weights
- product images
- GST/FSSAI/legal information
- shipping rules
- policies
- admin credentials
- Razorpay keys

For online payments, set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. The server creates Razorpay orders. Before going live, implement and verify the payment signature server-side and add webhook/payment-status handling. Never put the Razorpay secret in frontend code.

## Deployment
### Render/Railway/Fly/VM
Use:
`npm ci --omit=dev`
`npm start`

Persistent storage is required for the SQLite `data/` directory. For multiple application instances, use a managed database such as PostgreSQL instead of SQLite.

### Docker
`docker build -t masala-house .`
`docker run --env-file .env -p 3000:3000 -v $(pwd)/data:/app/data masala-house`

## Important
The 50 images included are generated visual placeholders for the catalogue, not photographs of a real client's packaging. Replace them with the client's actual product photography before commercial launch.

Production payment integration in this package creates Razorpay orders server-side and verifies the returned signature server-side. Add webhook handling and payment-status reconciliation before launch. Express production deployment should use production environment settings, compression, proper error handling, and an appropriate process/reverse-proxy setup.
