# Flatmate

A web app that matches exchange students who sublet their flat with exchange students looking for one, with the landlord in the loop.

Built for a hackathon. Contract templates are placeholders, not legal documents.

## What's in here

| Path | What it is |
|---|---|
| `index.html` | The page that loads the app |
| `css/brand.css` | **Colors, fonts, roundness.** Change these to rebrand |
| `js/brand.js` | **The app's name and welcome text** |
| `js/config.js` | Connection to your Supabase project |
| `js/schools.js` | Live school lists: French ministry open data, the worldwide ROR registry, the national address search |
| `js/views/` | One file per screen (onboarding, discover, chat, contract, profile, admin) |
| `supabase/schema.sql` | The database: tables, security rules, matching logic |
| `supabase/seed.sql` | Five demo flats in Paris |
| `supabase/update-2-schools-and-invites.sql` | Update for projects created before 10 Oct 2026, 13:00 (already inside schema.sql) |

There is no build step. The files are served as they are.

## Setup (about 15 minutes)

### 1. Create the database
1. In Supabase, open your project → **SQL Editor** → **New query**.
2. Paste the whole content of `supabase/schema.sql` and click **Run**. You should see "Success".
3. New query again, paste `supabase/seed.sql`, click **Run**.

### 2. Turn off email confirmation (for the hackathon)
Supabase → **Authentication** → **Sign In / Providers** → **Email** → turn off **Confirm email** → Save.
Without this, every new account must click a link in an email before using the app.

### 3. Connect the app to the database
1. Supabase → **Project Settings** → **API** (sometimes called **Data API**).
2. Copy the **Project URL** and the **anon public** key.
3. Put them in `js/config.js`. The anon key is meant to be public. Never use the `service_role` key.

### 4. Put it online
1. Vercel → **Add New** → **Project** → import the GitHub repository.
2. Leave every setting as it is and click **Deploy**.
3. Every change pushed to GitHub goes live automatically about a minute later.

### 5. Make yourself an admin
After creating your own account in the app, run this in the Supabase SQL Editor with your email:
```sql
update profiles set is_admin = true where email = 'you@example.com';
```
You then get a **Review verification checks** button in your profile.

## How the "real" parts work

- **Accounts, profiles, flats, photos, swipes, matches, stars, chat, contracts** are stored in Supabase.
- **Chat and contracts update live** for everyone in the conversation.
- **Matching:** a match is created when the seeker says yes to a flat and the subletter says yes to that seeker. Demo flats (Léa, Sofia, Inès) say yes automatically, so you can show a match on stage.
- **Landlord:** gets an invitation link from the chat. Opening it shows what the invitation is about and which account is logged in; only a landlord account can join, and only the email the tenant entered, if they entered one.
- **Identity and student checks:** documents are uploaded to private storage. In **demo mode** (the default) they're approved instantly. Switch to **manual review** from the admin page to approve each one yourself.
- **Logging in:** a login only lasts while the browser tab is open, and ends after 30 minutes without activity, unless the person ticks "Keep me logged in on this device".
- **Schools:** home universities come from the worldwide Research Organization Registry (ror.org). Destination schools come from the French higher-education ministry's list of recognised institutions, with the GPS position of their main site; students can pin another campus by address.
- **Travel time:** the flat's address is turned into coordinates with the French national geocoder (or OpenStreetMap outside France). Seekers see the time to their own campus; subletters see the time from their flat to each applicant's school and to recognised schools nearby. Times are estimates from distance, not live transit routes.
- **Demand:** counts views, yeses and stars from the last 7 days and compares each flat with the others in the same city. With little activity, it compares price per m² instead. Demo flats start with some interest so the badges show.
- **Contracts:** each person draws their signature on their own account. When all three have signed, anyone can save it as a PDF.

## Before a real launch
Delete the demo data, switch checks to manual review or a verification provider, have the contract templates written by a lawyer, add a privacy policy, and switch email confirmation back on.
