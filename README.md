<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This project now supports:

- multi-route image generation
- email login
- points billing
- MySQL-backed auth and billing storage

View your app in AI Studio: https://ai.studio/apps/drive/1MB-T6-X8pVklMaEwAk7UBHpKmeGDrBJi

## Run locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Copy [.env.example](./.env.example) to `.env`
3. Fill in your image route keys, SMTP settings, and either:
   `MYSQL_URL`
   or `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE`
   If you use docker-compose, the default host-side ports are:
   `PORT=3365`
   `MYSQL_HOST_PORT=3310`
4. Start the app:
   `npm run start`

### Resend email

This project uses SMTP for email login codes, so Resend works out of the box through its SMTP gateway:

- `SMTP_HOST=smtp.resend.com`
- `SMTP_PORT=465`
- `SMTP_SECURE=true`
- `SMTP_USER=resend`
- `SMTP_PASS=<your Resend API key>`
- `SMTP_FROM=Nano Banana Pro <noreply@yourdomain.com>`

### Default ports

- `5188` - Vite frontend dev server
- `3365` - Node.js backend / BaoTa reverse proxy target
- `3310` - Host-side MySQL bind for docker-compose

## MySQL migration

If you already have `auth-data.json` and `billing-data.json`, you can import them into MySQL after configuring the database variables in `.env`:

`npm run migrate:mysql`

The server will use MySQL automatically when MySQL env vars are present. If MySQL is not configured, it falls back to the legacy JSON stores for local development.
