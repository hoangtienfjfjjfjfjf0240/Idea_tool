# Idea Tool

## Run local

1. Install dependencies:

```bash
npm install
```

2. Create local env file from the template:

```bash
cp .env.example .env.local
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env.local
```

3. Fill these required Supabase variables in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

4. Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes

- If Supabase env vars are missing, the app will show a setup screen instead of crashing.
- `NEXT_PUBLIC_DISABLE_AUTH=true` is enabled by default in `.env.example` for local development.
- Some AI features also need `AI_BASE_URL` and `AI_API_KEY` or Gemini-related env vars.
