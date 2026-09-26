### Op-server

Backend application for the Opinions Poll project, built with **NestJS**, **TypeScript**, and **MongoDB (Mongoose)**.

#### Prerequisites
- Node.js (v18+)
- MongoDB running locally or remotely

#### Steps to Run

1. Clone the repository
2. Run `npm install`
3. Configure `.env` (refer to `.env.example`)
4. Start the development server:
   ```bash
   npm run dev
   ```
   Or for production:
   ```bash
   npm run build
   npm run start:prod
   ```

#### API Prefix
All routes are prefixed with `/api`:
- `/api/app/title`
- `/api/auth/*`
- `/api/users/*`
- `/api/issues/*`
- `/api/polls/*`
