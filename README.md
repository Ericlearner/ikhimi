# 익히미 (Ikhimi)

AI homework for foreign-language teachers in Korea (schools and 학원). A teacher photographs a textbook page or types
one sentence and gets checked, auto-graded homework; students do it on their phones and the teacher reads the report.
The interface is Korean only.

익히미 started on 2026-10-22 as a separate copy of another app's code (see [DECISIONS.md](DECISIONS.md), section
"Korean version"). It shares no database, keys, bots, domain or app IDs with that app, and nothing here is synced from
it: changes are made here, for Korea.

## Put it online (once)

You need accounts at GitHub, Neon (database), Vercel (hosting), Google AI Studio (AI) and Telegram.

1. **GitHub.** Create a new, empty, **private** repository (e.g. `ikhimi`), then in this folder:
   ```bash
   git remote add origin https://github.com/<you>/ikhimi.git
   git push -u origin main
   ```
2. **Database (Neon).** neon.tech → New project, name `ikhimi`, Postgres 16, the region closest to Korea. Copy the
   connection string (it starts with `postgres://`). pgvector is turned on by the first migration.
3. **AI key.** aistudio.google.com/apikey → Create API key, in a new Google Cloud project for 익히미 (so its bill and
   limits are its own).
4. **Telegram bot.** In Telegram, [@BotFather](https://t.me/BotFather) → `/newbot` → a name (익히미) and a username
   ending in `bot` (e.g. `ikhimi_bot`). Keep the token. Never reuse another app's bot: one bot can only have one site.
5. **Vercel.** vercel.com → Add New → Project → import the GitHub repository →
   - Root Directory: `apps/web` (Framework: Next.js; the rest stays default)
   - Environment Variables (Production), at least:

     | Name | Value |
     |---|---|
     | `DATABASE_URL` | the Neon connection string |
     | `AUTH_PEPPER` | a long random string (`openssl rand -hex 32`) |
     | `GEMINI_API_KEY` | the AI Studio key |
     | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | from BotFather (username without `@`) |
     | `TELEGRAM_WEBHOOK_SECRET` | another random string (`openssl rand -hex 24`) |
     | `PUBLIC_ORIGIN` | the site's address, e.g. `https://ikhimi.vercel.app` (later your own domain) |
     | `OWNER_PHONES` | your phone in international form, e.g. `+821012345678` (you become the admin) |
     | `CRON_SECRET` | another random string (the daily reminders job) |

     Leave `S3_*` unset on Vercel (files are kept in the database). Everything else is optional and explained in
     [.env.example](.env.example): bank transfers (`PAY_*`), Google/Apple sign-in, SMS codes, model choices.
   - Deploy. Every deploy runs the database migrations and the methodology seed by itself (`vercel-build`).
6. **Connect the bot.** Open the site, sign in with Telegram using the `OWNER_PHONES` number (the bot asks you to
   share your number), set a password, then **관리자 → 상태 → 텔레그램 메시지 → 봇 설정**. That registers the webhook,
   the menu and the bot's Korean description.
7. **Your domain (later).** Vercel → Settings → Domains → add it, point the DNS as Vercel says, then change
   `PUBLIC_ORIGIN` and redeploy, and press **봇 설정** again.
8. **Before real users:** fill the `[대괄호]` business details in `apps/web/src/content/site.ts` (상호, 대표자,
   사업자등록번호, 통신판매업 신고번호, 주소, 개인정보 보호책임자) and have a Korean lawyer review the privacy policy and
   terms in `apps/web/src/content/legal.ts`.

Prices (Pro 9,900원, VIP 14,900원 a month by default) are changed in 관리자 → 매출 → 요금제 가격. The apps:
[apps/android/README.md](apps/android/README.md) and [apps/ios/README.md](apps/ios/README.md) (new signing key, new
store listings).

## Run it locally

Requirements: Node 22+, pnpm (`corepack enable`), Docker.

```bash
pnpm install
docker compose up -d                 # Postgres 16 + pgvector, SeaweedFS (S3) on :9000
cp .env.example apps/web/.env.local  # and set AUTH_PEPPER (`openssl rand -hex 32`)
cp apps/web/.env.local workers/.env

set -a; . workers/.env; set +a
pnpm db:migrate
pnpm storage:init
pnpm db:seed                         # optional: demo teacher 김지은 + 3 classes + 38 students

pnpm dev                             # http://localhost:3000
pnpm worker                          # second terminal: background jobs
```

AI: set `GEMINI_API_KEY`; for demos without a key, `LLM_FAKE=1` answers with canned Korean homework.

**Log in with Telegram:** put a test bot's `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET`
in `apps/web/.env.local`, and run `pnpm telegram:poll` in a third terminal. The phone + code form also works; with
`SMS_PROVIDER=console`, codes are printed in the `pnpm dev` terminal.

## Layout

```
apps/web          Next.js 16 (App Router): marketing, teacher app, student app, API routes
apps/android      Android apps (Trusted Web Activity): Google Play, and an APK for the website
apps/ios          iOS app (Swift): the site plus Sign in with Apple, push, camera, microphone
packages/db       Drizzle schema + migrations, pg-boss queues, S3 storage, [DECIDE] config constants
packages/i18n     The Korean message catalog, phone/date/money formatting (010-1234-5678, 2026.10.22, 9,900원)
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
