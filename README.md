# Brahmastra — setup & deploy guide

This is a full working clone-style app: paste a syllabus → AI extracts topics →
print-ready cheatsheet (PDF/DOCX), with real accounts, credits, and payments.

You need to wire up **3 free/low-cost services** before it works. Takes ~20 minutes.

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
  credits integer not null default 1,
  created_at timestamp with time zone default now()
);

alter table profiles enable row level security;

create policy "Users can view their own profile"
  on profiles for select
  using (auth.uid() = id);

-- auto-create a profile with 1 free credit whenever someone signs up
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, credits) values (new.id, 1);
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

## 3. Razorpay — payments (India)

1. Go to https://razorpay.com → sign up → complete KYC to accept real payments
   (you can use **Test Mode** immediately without KYC to try the whole flow).
2. Go to **Settings → API Keys** → generate Test (or Live) keys.
3. You'll need `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` for Netlify env vars.

While in Test Mode, use Razorpay's test card `4111 1111 1111 1111`, any future
expiry, any CVV, to simulate a payment.

---

## 4. Deploy to Netlify

1. Push this folder to a GitHub repo (or drag-and-drop deploy on Netlify — but
   drag-and-drop won't pick up the `netlify/functions` folder correctly for
   npm dependencies, so a GitHub-connected deploy is strongly recommended).
2. On https://app.netlify.com → **Add new site → Import from Git** → pick the repo.
3. Build settings: leave build command empty, publish directory `.`
   (already set in `netlify.toml`).
4. Go to **Site settings → Environment variables** and add:

   | Key | Value |
   |---|---|
   | `GROQ_API_KEY` | from step 1 |
   | `GROQ_MODEL` | `openai/gpt-oss-120b` (optional, this is the default) |
   | `GEMINI_API_KEY` | from step 1.5 (optional, but recommended) |
   | `GEMINI_MODEL` | `gemini-3.6-flash` (optional, this is the default) |
   | `SUPABASE_URL` | from step 2 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 2 (service_role, NOT anon) |
   | `RAZORPAY_KEY_ID` | from step 3 |
   | `RAZORPAY_KEY_SECRET` | from step 3 |

   **Important:** set both `GROQ_API_KEY` and `GEMINI_API_KEY` for the
   Production deploy context (and Preview/Branch contexts too, if you test
   there). A missing or invalid Gemini key means a Groq rate limit will show
   the “heavy traffic” message instead of generating the sheet.

5. Deploy. Netlify will auto-install `@supabase/supabase-js` and `razorpay`
   from `package.json` for the functions.
6. Visit your live URL — sign up, paste a syllabus, generate.

---

## What's real vs. what to double check

- ✅ Real AI extraction (Groq, with automatic Gemini fallback on rate limits)
- ✅ Real accounts + row-level-secured credit balances (Supabase)
- ✅ Real payment verification (Razorpay signature check happens server-side)
- ✅ Real PDF/DOCX export, generated in the browser (jsPDF / docx.js)
- ⚠️ Email confirmation is on by default in Supabase — turn off for a smoother
  demo, or leave on for production.
- ⚠️ `privacy.html` / `terms.html` are placeholders — replace before real users sign up.
- ⚠️ Razorpay needs completed KYC before it can accept **real** money; Test Mode
  works immediately for demos.

---

## Local folder structure

```
brahmastra/
├── index.html            landing page
├── pricing.html          pricing + buy flow
├── dashboard.html        the app (syllabus → cheatsheet)
├── privacy.html / terms.html
├── css/style.css
├── js/
│   ├── supabase-client.js   ← paste your Supabase URL/key here
│   ├── dashboard.js          app logic, PDF/DOCX export
│   └── payments.js           Razorpay checkout flow
├── netlify/functions/
│   ├── generate.js           calls Groq, deducts a credit
│   ├── create-order.js       creates a Razorpay order
│   └── verify-payment.js     verifies payment, tops up credits
├── netlify.toml
└── package.json
```
