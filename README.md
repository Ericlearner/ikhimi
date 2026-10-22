# 익히미 (Ikhimi)

AI homework for foreign-language teachers in Korea (schools and 학원). A teacher photographs a textbook page or types
one sentence and gets checked, auto-graded homework; students do it on their phones and the teacher reads the report.
The interface is Korean only.

익히미 started on 2026-10-22 as a separate copy of another app's code (see [DECISIONS.md](DECISIONS.md), section
"Korean version"). It shares no database, keys, bots, domain or app IDs with that app, and nothing here is synced from
it: changes are made here, for Korea.

## Put it online (once)

You need accounts at GitHub, Neon (database), Vercel (hosting) and Google Cloud (AI and sign-in).

1. **GitHub.** Create a new, empty, **private** repository (e.g. `ikhimi`), then in this folder:
   ```bash
   git remote add origin https://github.com/<you>/ikhimi.git
   git push -u origin main
   ```
2. **Database (Neon).** neon.tech → New project, name `ikhimi`, Postgres 16, the region closest to Korea. Copy the
   connection string (it starts with `postgres://`). pgvector is turned on by the first migration.
3. **AI key.** aistudio.google.com/apikey → Create API key, in a new Google Cloud project for 익히미 (so its bill and
   limits are its own).
4. **Sign in with Google.** console.cloud.google.com, in the same project → APIs & Services → **OAuth consent
   screen**: External, app name 익히미, your support email; then **Publish app** (in "Testing" only listed test users
   can sign in). Then **Credentials** → Create credentials → **OAuth client ID** → Web application → Authorized
   redirect URIs: `https://<your Vercel address>/api/auth/google/callback` (add your own domain's later). Keep the
   client ID and secret. Google is the only way in on the website and in the Android apps; the iOS app uses Sign in
   with Apple (apps/ios/README.md).
5. **Vercel.** vercel.com → Add New → Project → import the GitHub repository →
   - Root Directory: `apps/web` (Framework: Next.js; the rest stays default)
   - Environment Variables (Production), at least:

     | Name | Value |
     |---|---|
     | `DATABASE_URL` | the Neon connection string |
     | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from step 4 |
     | `GEMINI_API_KEY` | the AI Studio key |
     | `PUBLIC_ORIGIN` | the site's address, e.g. `https://ikhimi.vercel.app` (later your own domain) |
     | `OWNER_EMAILS` | the Google email you sign in with (you become the admin) |
     | `CRON_SECRET` | a long random string (`openssl rand -hex 24`), for the daily reminders job |

     Leave `S3_*` unset on Vercel (files are kept in the database). Everything else is optional and explained in
     [.env.example](.env.example): Apple sign-in and notifications for the iOS app, model choices.
   - Deploy. Every deploy runs the database migrations and the methodology seed by itself (`vercel-build`).
6. **Sign in.** Open the site, press **Google로 계속하기** with the `OWNER_EMAILS` account, and answer the welcome
   questions. **관리자** (Admin) appears in your menu.
7. **Your domain (later).** Vercel → Settings → Domains → add it, point the DNS as Vercel says, then change
   `PUBLIC_ORIGIN`, add `https://<domain>/api/auth/google/callback` to the Google OAuth client, and redeploy.
8. **Before real users:** fill the `[대괄호]` business details in `apps/web/src/content/site.ts` (상호, 대표자,
   사업자등록번호, 통신판매업 신고번호, 주소, 개인정보 보호책임자, and the support email that the help pages and the
   help chat's "팀에 메일 쓰기" use) and have a Korean lawyer review the privacy policy and terms in
   `apps/web/src/content/legal.ts`.

Notifications (new homework, due tomorrow, graded, the teacher's reminder) reach people who use the iOS app with
notifications on; everyone else sees their homework in 내 숙제. Nothing is sold until a payment gateway (e.g. Toss
Payments) is connected in `apps/web/src/server/payments/providers.ts`.

Prices (Pro 9,900원, VIP 14,900원 a month by default) are changed in 관리자 → 매출 → 요금제 가격. The apps:
[apps/android/README.md](apps/android/README.md) and [apps/ios/README.md](apps/ios/README.md) (new signing key, new
store listings).

## Run it locally

Requirements: Node 22+, pnpm (`corepack enable`), Docker.

```bash
pnpm install
docker compose up -d                 # Postgres 16 + pgvector, SeaweedFS (S3) on :9000
cp .env.example apps/web/.env.local  # and set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (below)
cp apps/web/.env.local workers/.env

set -a; . workers/.env; set +a
pnpm db:migrate
pnpm storage:init
pnpm db:seed                         # optional: demo teacher 김지은 + 3 classes + 38 students

pnpm dev                             # http://localhost:3000
pnpm worker                          # second terminal: background jobs
```

AI: set `GEMINI_API_KEY`; for demos without a key, `LLM_FAKE=1` answers with canned Korean homework.

**Signing in locally:** add `http://localhost:3000/api/auth/google/callback` to the Google OAuth client's redirect
URIs and put its ID and secret in `apps/web/.env.local`. Put your Google email in `OWNER_EMAILS` for the admin panel,
and in `SEED_TEACHER_EMAIL` before `pnpm db:seed` to sign in as the demo teacher.

## Layout

```
apps/web          Next.js 16 (App Router): marketing, teacher app, student app, API routes
apps/android      Android apps (Trusted Web Activity): Google Play, and an APK for the website
apps/ios          iOS app (Swift): the site plus Sign in with Apple, push, camera, microphone
packages/db       Drizzle schema + migrations, pg-boss queues, S3 storage, [DECIDE] config constants
packages/i18n     The Korean message catalog, date/money/phone formatting (2026.10.22, 9,900원, 010-1234-5678)
packages/ai       Prompts and checks for homework, grading, the tutor; the AI boundary (sanitizeForLLM / assertNoPII)
packages/pedagogy Methodology knowledge base
packages/ui       Brand tokens (light + dark), components, sounds
workers/          pg-boss job handlers (material.ingest)
evals/            Generation quality suite (Korean teacher requests)
brand/            Logo assets; copied into apps/web/public at build
```

## Conventions

- **Strings:** every screen text is in `packages/i18n/messages/ko.json` (polite 해요체; buttons are short nouns).
  AI prompts are written in English and ask for Korean instructions and explanations (`LOCALE_NAME` in
  `packages/ai/src/generate.ts`).
- **Time:** days, deadlines and the daily job follow Seoul time (UTC+9).
- **Schema changes:** edit `packages/db/src/schema.ts`, then run `pnpm db:generate`. CI fails if a schema change has
  no migration.
- **Money:** integer KRW everywhere. No floats.
- **Authorization:** routes call `authorize(actor, action, resource)` from `apps/web/src/server/policy.ts`, never
  ad-hoc checks.
- **AI calls:** everything outbound goes through `sanitizeForLLM` / `assertNoPII` in `packages/ai` (names with
  Korean particles, Korean phone numbers and 주민등록번호 are caught).

## Tests

`pnpm test` runs unit tests plus DB-backed tests against in-process Postgres (PGlite + pgvector), so they need no
Docker. CI also applies the migrations to a real Postgres 16 service and builds the web app.
