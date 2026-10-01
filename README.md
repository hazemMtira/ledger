# Ledger

A personal finance website with a tab for each person (you, your dad, anyone), AI help, and live sharing.

- **Frontend:** plain HTML, CSS and JavaScript. No build step.
- **Backend:** Supabase (logins, database, live updates, one Edge Function).
- **AI:** Google Gemini free tier, called only from the Edge Function so the key stays secret.
- **Hosting:** GitHub Pages or Netlify, both free.

```
ledger-site/
  index.html
  css/style.css
  js/config.js            <- you paste 2 values here
  js/app.js
  netlify.toml
  supabase/
    schema.sql            <- run once in Supabase
    functions/ai/index.ts <- the AI function
```

## What you can do in it

- Tabs per person. Add a tab for anyone, rename it, set its currency and a monthly savings goal.
- Add money in or out with a form, or type a sentence and let the AI split it into entries.
- Edit or delete entries. See earned, spent and left per month, a category breakdown and a 6-month trend.
- AI: analyze the month, build next month's budget, or ask a question about the tab.
- Share a tab with someone who has an account, as "add and edit" or "only view". Changes appear live for both of you.
- Password reset by email and CSV download for each tab.

---

## Setup (about 30 minutes, all free)

### 1. Create the Supabase project
1. Sign up at https://supabase.com and click **New project**.
2. Pick a name and a region near you, and save the database password.
3. Wait a minute while it is created.

### 2. Create the database
1. Open **SQL Editor** -> **New query**.
2. Paste the whole content of `supabase/schema.sql` and click **Run**. It should say "Success".

### 3. Get your two public values
Go to **Project Settings -> API** and copy:
- **Project URL**
- **anon public** key

Paste them into `js/config.js`. They are safe to publish, because the security rules from step 2 protect the data.

### 4. Get a free Gemini key
1. Go to https://aistudio.google.com and sign in with a Google account.
2. Click **Get API key** and create one. No credit card is needed.
3. Copy it.

### 5. Deploy the AI function

**Easiest way, in the browser:**
1. Supabase dashboard -> **Edge Functions** -> **Deploy a new function** -> **Via Editor**.
2. Name it exactly `ai`.
3. Replace the code with the content of `supabase/functions/ai/index.ts` and deploy.

**Or with the command line:**
```
npm install -g supabase        # or see supabase.com/docs/guides/cli
supabase login
supabase init                  # accept the defaults, keep the existing supabase folder
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy ai
```
The project ref is the part of your project URL before `.supabase.co`.

**Then add the secret.** Dashboard -> **Edge Functions -> Secrets** (or CLI):
```
supabase secrets set GEMINI_API_KEY=your-gemini-key
```

### 6. Test it on your computer
In the project folder:
```
python3 -m http.server 8080
```
Open http://localhost:8080, create an account, add some entries and try the AI buttons.
For local testing in step 1, you can turn off email confirmation in **Authentication -> Providers -> Email -> Confirm email**. Turn it back on before real use.

### 7. Put it online

**Option A: Netlify**
1. Put the folder on GitHub (see below), then on https://netlify.com choose **Add new site -> Import from Git**.
2. Pick the repo. Leave the build command empty. The publish directory is `.` (already set in `netlify.toml`).
3. Or skip Git: drag the folder onto https://app.netlify.com/drop.

**Option B: GitHub Pages**
1. Create a GitHub repo and upload all the files (or `git push`).
2. Repo **Settings -> Pages -> Build and deployment**: source **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Your site is at `https://YOUR-NAME.github.io/REPO-NAME/`.

### 8. Tell Supabase about your live address
1. **Authentication -> URL Configuration**: set **Site URL** to your live address (for example `https://my-ledger.netlify.app/`). Add the same address, and `http://localhost:8080/` if you test locally, under **Redirect URLs**. This is what makes confirmation and password reset emails work.
2. Lock the AI function to your site. Add a secret:
```
supabase secrets set ALLOWED_ORIGINS=https://my-ledger.netlify.app,http://localhost:8080
```
Use only the domain part. For GitHub Pages that is `https://YOUR-NAME.github.io` with no repo path.

### 9. Share with your dad
1. You and your dad each create an account on the site.
2. In your tab, open **Tab settings -> Share this tab**, enter his email and choose "Add and edit" or "Only view".
3. He sees your tab next to his own and can add his own private tab with **+ Add person**.

---

## About the free tiers

- **Supabase free plan:** enough for a family. Check https://supabase.com/pricing for current limits. Free projects may pause after a period of inactivity; open the dashboard to wake it up.
- **Gemini free tier:** the limits change and are shown in your Google AI Studio dashboard. This app caps each user at 30 AI requests per day (`AI_DAILY_LIMIT`) so a few people share the quota comfortably. If it is used up, the app shows a built-in summary that needs no AI.
- **Privacy:** on Gemini's free tier, Google may use the content you send to improve its products. The AI buttons send that tab's entries and notes. If that bothers you, enable billing on the Google project (paid usage is not used for training and costs very little at this size), or just do not use the AI buttons. Everything else works without them.

## Troubleshooting

| Problem | Fix |
|---|---|
| Page says "Setup needed" | Fill in `js/config.js` |
| "new row violates row-level security" | Run `schema.sql` again in a fresh project, or check it ran without errors |
| AI says "Sign in first" or fails to connect | Check the function is named exactly `ai` and deployed |
| AI says "not configured" | Add the `GEMINI_API_KEY` secret |
| AI says "refused the request" | Wrong key, or the model name is not available. Set `GEMINI_MODEL` to a free Flash model from AI Studio |
| AI works locally but not on the live site | Add your live domain to `ALLOWED_ORIGINS` |
| Confirmation email links go to the wrong place | Fix Site URL and Redirect URLs in step 8 |
| "No account with that email yet" when sharing | The other person must sign up first |

## Known limits

- Charts and lists load the last 6 months per tab (up to the first few thousand entries).
- Entries are protected by Supabase security rules but are not end-to-end encrypted.
- Sharing works by email with existing accounts only. There are no invite links.
