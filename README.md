# Mise en Place Magic

Restaurant inventory, recipe costing, invoice scanning, and sales deduction tools for independent operators.

## Local Development

Install dependencies:

```sh
npm install
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

## Project Stack

- Vite
- React
- TypeScript
- Supabase
- Tailwind CSS
- shadcn/ui
