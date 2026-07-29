# Mise en Place Magic

Restaurant inventory, recipe costing, invoice scanning, and sales deduction tools for independent operators.

## Local Development

Install dependencies:

```sh
npm ci
```

Start the local site:

```sh
npm run dev
```

Open the local URL shown in the terminal, usually:

```txt
http://localhost:8080
```

## AI Scanning

Menu and invoice scanning use Supabase Edge Functions and Google Gemini.

Required Supabase secret:

```txt
GEMINI_API_KEY
```

Optional Supabase secret:

```txt
GEMINI_MODEL=gemini-2.5-flash
```

After changing Edge Function code or secrets, deploy the functions:

```sh
supabase functions deploy scan-menu
supabase functions deploy scan-invoice
```

Menu URL scanning uses Gemini URL Context. The Edge Function verifies that the
requested page was retrieved before accepting extracted recipes.

## Database and POS setup

Apply migrations before deploying frontend changes that call new database
functions:

```sh
supabase db push
```

POS OAuth and webhooks require the provider-specific secrets used by the Edge
Functions. Configure only the providers you enable:

```txt
APP_URL
ALLOWED_APP_ORIGINS
SQUARE_CLIENT_ID
SQUARE_CLIENT_SECRET
SQUARE_WEBHOOK_SIGNATURE_KEY
CLOVER_CLIENT_ID
CLOVER_CLIENT_SECRET
CLOVER_WEBHOOK_AUTH_CODE
TOAST_CLIENT_ID
TOAST_CLIENT_SECRET
TOAST_WEBHOOK_SECRET
LIGHTSPEED_CLIENT_ID
LIGHTSPEED_CLIENT_SECRET
LIGHTSPEED_WEBHOOK_SECRET
```

Never place provider secrets in a `VITE_*` variable. Browser-facing provider
client IDs may be copied into `.env` using the names in `.env.example`.

## Verification

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
```

## Project Stack

- Vite
- React
- TypeScript
- Supabase
- Tailwind CSS
- shadcn/ui
