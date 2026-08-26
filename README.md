# Brahmastra — setup & deploy guide

This is a full working clone-style app: paste a syllabus → AI extracts topics →
print-ready cheatsheet (PDF/DOCX), with accounts and three free credits per new user.

You need to wire up the AI providers and Supabase before it works.

---

## 1. Groq — free AI API (topic extraction)

Groq gives a genuinely free API key with fast Llama models. This is what replaces
"ChatGPT" in the backend.

1. Go to https://console.groq.com → sign up (free).
2. Go to **API Keys** → Create key → copy it.
3. You'll paste this into Netlify env vars as `GROQ_API_KEY` (step 4 below).

No credit card needed. **Free tier limits: ~30 requests/minute, ~1,000/day**
— fine for testing and a modest launch, but if a lot of students hit the site
at the same time, requests beyond that get rejected. That's what step 1.5
(Gemini fallback) below is for.

---

## 1.5 Google Gemini — free fallback, for when Groq is under heavy load

This app automatically falls back to Gemini if Groq is rate-limited, so a
traffic spike doesn't take the site down. Gemini's free tier is more generous
(~1,500 requests/day), so it absorbs overflow well.

1. Go to https://aistudio.google.com/apikey → sign in with Google → Create API key.
2. Copy it — you'll add it to Netlify as `GEMINI_API_KEY` (step 4 below).

This step is optional but strongly recommended. Without it, if Groq is
overloaded the app just shows "heavy traffic, try again" instead of silently
switching providers.

**If you outgrow both free tiers** (real, sustained traffic — not just spikes):
Groq's paid "Developer" tier removes the rate ceiling, needs no monthly fee,
you only pay for what you use, and it's inexpensive (Llama 3.3 70B is roughly
$0.59 per million input tokens — a syllabus is a few thousand tokens, so this
stays cheap even at real scale). Add a card on the same Groq account and the
existing `GROQ_API_KEY` keeps working — no code changes needed.

---

## 2. Supabase — free database + login system

1. Go to https://supabase.com → create a free project.
2. Once created, go to **Project Settings → API** and copy:
   - `Project URL` → goes into `js/supabase-client.js` as `SUPABASE_URL`
   - `anon public` key → goes into `js/supabase-client.js` as `SUPABASE_ANON_KEY`
   - `service_role` key (keep secret!) → goes into Netlify env var `SUPABASE_SERVICE_ROLE_KEY`
3. Go to **SQL Editor** → New query → paste and run this:

```sql
-- profiles table: 1 row per user, tracks credits
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  credits integer not null default 3,
  created_at timestamp with time zone default now()
);

alter table profiles enable row level security;

create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

-- auto-create a profile with 3 free credits whenever someone signs up
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, credits) values (new.id, 3);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

4. Go to **Authentication → Providers** and make sure "Email" is enabled
   (it is by default). Optionally turn off "Confirm email" under
   **Authentication → Settings** while testing, so signup doesn't require
   clicking an email link.
5. Open `js/supabase-client.js` in this project and paste in your URL + anon key.

---

## 3. Deploy to Vercel

1. Push this folder to a GitHub repository.
2. On https://vercel.com/new, import that repository and deploy it.
3. In **Project Settings → Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `GROQ_API_KEY` | from step 1 |
   | `GROQ_MODEL` | `openai/gpt-oss-120b` (optional, this is the default) |
   | `GEMINI_API_KEY` | from step 1.5 (optional, but recommended) |
   | `GEMINI_MODEL` | `gemini-3.6-flash` (optional, this is the default) |
   | `SUPABASE_URL` | from step 2 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 2 (service_role, NOT anon) |
   **Important:** set both `GROQ_API_KEY` and `GEMINI_API_KEY` for the
   Production environment (and Preview too, if you test there).

4. Deploy. Vercel automatically installs the dependencies and deploys the
   `/api` functions.
5. Run [`supabase/free-plan.sql`](supabase/free-plan.sql) once in Supabase SQL
   Editor to give every new account three free credits.

---

## What's real vs. what to double check

- ✅ Real AI extraction (Groq, with automatic Gemini fallback on rate limits)
- ✅ Real accounts + row-level-secured credit balances (Supabase)
- ✅ Three free credits for every new account; no payment flow or subscriptions
- ✅ Real PDF/DOCX export, generated in the browser (jsPDF / docx.js)
- ⚠️ Email confirmation is on by default in Supabase — turn off for a smoother
  demo, or leave on for production.
- ⚠️ `privacy.html` / `terms.html` are placeholders — replace before real users sign up.

---

## Local folder structure

```
brahmastra/
├── index.html            landing page
├── pricing.html          free-plan information
├── dashboard.html        the app (syllabus → cheatsheet)
├── privacy.html / terms.html
├── css/style.css
├── js/
│   ├── supabase-client.js   ← paste your Supabase URL/key here
│   ├── dashboard.js          app logic, PDF/DOCX export
├── api/
│   └── generate.js           Vercel generator endpoint
├── netlify/functions/
│   └── generate.js           shared generator logic
├── supabase/free-plan.sql    three-credit database setup
└── package.json
```
