# Open decisions for the founder

## Korean version (2026-10-22)

익히미 is a separate copy of an earlier app built for Uzbekistan, made Korean on 2026-10-22. Everything below this
section was decided for that app and is kept as the history of how the product works; where it names Uzbek things
(so'm, Payme/Click, Tashkent, ZRU-547, Uzbek scripts), the Korean version replaced them as follows:

- **Language:** the interface is Korean only (`packages/i18n/messages/ko.json`); no language switcher. Homework
  instructions, explanations, the tutor and the help chat are in Korean (해요체). Learners' first language in every AI
  prompt is Korean (pronunciation: the sounds Korean speakers find hard).
- **Languages taught:** English, Japanese, Chinese, German, French, Spanish, Russian, Turkish, Arabic, and Korean as a
  foreign language. Uzbek was removed. Hangul in a teacher's request no longer means "Korean is taught": only a
  language's name, its exams or its own script do.
- **Exams:** 수능 영어 (CSAT) and TOEIC were added first for English; Uzbekistan's national exam was removed.
- **Money:** integer won (KRW), shown as 9,900원. Defaults: Pro 9,900원, VIP 14,900원 a month per student; a paid course
  10,000원 to 2,000,000원. Payme and Click were removed; until a Korean gateway (e.g. Toss Payments) is connected,
  people pay by bank transfer (계좌이체) in the Telegram bot (`PAY_ACCOUNT_NUMBER`, `PAY_BANK_NAME`,
  `PAY_ACCOUNT_HOLDER`), approved by hand as before.
- **Time:** Seoul (UTC+9) for days, deadlines, streaks and the daily job (18:00 KST = `0 9 * * *` UTC).
- **Phones:** Korean numbers by default (010-1234-5678); login codes by Telegram Gateway or Twilio (`SMS_PROVIDER`).
- **Privacy filter:** Korean names are caught with particles attached and by given name alone; Korean phone numbers
  and 주민등록번호 are caught too.
- **Legal:** the privacy policy and terms are drafts for Korean law (개인정보 보호법, 전자상거래법), with the
  business details the law requires in the footer; all `[대괄호]` items must be filled and a lawyer must review them
  before launch.
- **Addresses:** web pages moved to plain English paths (`/plans`, `/courses`, `/course/…`, `/privacy`, `/terms`,
  `/help`, `/about`, `/android`, `/delete-account`, `/parent/…`, `/pay/…`, `/work/mistakes`, `/app/packages`,
  `/app/earnings`); the bot's commands and deep links are `/plans`, `?start=plan…` and `?start=course_…`.
- **Apps:** new IDs `kr.ikhimi.app` (Android, iOS) and `kr.ikhimi.app.web` (the website's APK); a new signing key is
  needed, and the APK download stays hidden until `ANDROID_APK_VERSION` is set.

Open for the Korean version: the domain, a payment gateway, KakaoTalk (Koreans use it far more than Telegram for
notifications and support), a Korean SMS provider, the business registration, and where the data is hosted.

---

Each default below is already implemented. Business values live in `packages/db/src/config.ts` (`CONFIG`),
so changing one is a one-line edit.

## From the build spec (§19). Answers needed before Phase 3.

| # | Question | Current default | Where |
|---|---|---|---|
| 1 | **Data residency.** Does ZRU-547 require in-country hosting and operator registration for this data? **Blocks real student signups.** | Everything is self-hostable. Postgres, storage, queue and auth run on one VPS. Only learning content reaches the Claude API, via `sanitizeForLLM`. | §6 |
| 2 | Under-14 students: guardian consent and how it works | Collect `birthYear`; require `guardianPhone` if under 14 | `CONFIG.guardianRequiredUnderAge` |
| 3 | Student pricing, trial, sibling discount | 25 000 KRW/course/month; first 3 assignments free; −30% for 2nd+ sibling; 3-day grace | `CONFIG.pricing` |
| 4 | Do students see the class leaderboard? | Off, with a per-group toggle | `CONFIG.studentLeaderboardDefault`, `groups.students_see_leaderboard` |
| 5 | ASR hosting | External API for teacher lesson audio; self-hosted for student speech | `CONFIG.asr` |
| 6 | iOS subscriptions | Web-only, Android first | `CONFIG.iosInAppPurchase` |
| 7 | Course lesson release | Manual | `CONFIG.courseLessonRelease` |
| 8 | Daily generation cap per teacher | 20 | `CONFIG.generationDailyCapPerTeacher` |
| 9 | Typo tolerance in gap-fill | On for words over 4 chars | `CONFIG.gapFillTypoToleranceMinWordLength` |
| 10 | Retention for inactive students | 24 months | `CONFIG.studentDataRetentionMonths` |
| 11 | School-admin tier and pricing | Not built (Phase 5) | — |
| 12 | Is `ikhimi.kr` registered? | Share links use `PUBLIC_ORIGIN`, default `https://ikhimi.kr` | `CONFIG.publicOrigin` |

## Found during Phase 0

**A. MinIO is no longer a safe choice (§6 names it).** MinIO's open-source server is archived and gets no
security updates, and the community binaries now return *410 Gone*. The app uses the plain S3 API, so the
store can be swapped. Local dev now runs **SeaweedFS** (Apache-2.0, maintained). SeaweedFS was tested with
presigned browser uploads, including rejection of oversize files.
*Decide:* SeaweedFS or Garage on the Tashkent VPS, or an Uzbek provider's S3 service if one meets residency.

**B. Eskiz only delivers pre-approved SMS templates.** The OTP text (`sms.otp` in each locale) must be
registered with Eskiz before production, or codes won't arrive. Registering it needs a signed Eskiz contract.

**C. Money is stored as integer KRW**, not tiyin. The spec asked for one or the other.

**D. Schema additions beyond §7:** `sessions` and `otp_codes` (needed for phone auth), plus
`groups.students_see_leaderboard` (the per-group toggle from #4).

**E. The first sign-up path creates teachers.** Students will join only through an assignment link (Phase 1),
so `/signin` makes every new account a teacher.

**G. Login is through a free Telegram bot for now.** "Telegram orqali kirish" opens our bot, the user
taps "📱 Raqamni yuborish" (send my number), and Telegram gives us their verified phone number from any
country. Nothing to type and no cost; the bot also gets the user's chat for free notifications later (§12).
Only the sender's own contact is accepted, so someone else's number can't be used to log in. The
phone-code form stays on the page but is hidden in production until SMS is connected. For launch, connect
Eskiz (`SMS_PROVIDER=eskiz`) for people without Telegram; the paid Telegram Gateway connector is also
available (`SMS_PROVIDER=telegram`).
*Known limit:* like any link-based login, a scammer could send someone a login link and ask them to share
their number. The bot warns "if you didn't start this login, ignore this message".

**F. Phone numbers from any country.** Many Uzbeks live abroad, so sign-up accepts any country's number.
Uzbekistan (+998) is the default; the picker lists Russia, Kazakhstan, Korea, Türkiye, the US and other
countries with large Uzbek communities first. SMS is routed by country: +998 goes to Eskiz / Play Mobile,
and everything else goes to an international provider (Twilio adapter, `SMS_INTL_PROVIDER`).
*Decide:* the international provider and its budget. International SMS costs roughly 5–20× a local one, and
it's the main target of SMS-pumping fraud. The per-phone and per-IP limits apply to it, but consider a
monthly spend cap with the provider, and offering Telegram login for users abroad (Phase 3 bot).

**H. The AI is Google Gemini's free tier for now.** Homework generation uses `gemini-3.8-flash` through a
provider interface (`packages/ai/src/llm`). The spec's Claude models slot in later as another adapter.
On the free tier Google may use what we send to improve its products. We only send learning content
(textbook photos, the teacher's sentence, generated items); names and phone numbers are stripped by
`sanitizeForLLM`, and the adapter refuses any payload that still contains them. The free tier also has
per-minute limits: under load, teachers see "AI hozir band" (the AI is busy) and can retry.
*Decide:* when real classes start, move to a paid plan (Gemini paid tier or Claude) so data isn't used
for training and limits are higher.

**I. Uploads are stored in Postgres when no S3 store is configured.** Photos are resized on the phone
(1600px, about 300 KB), so this is fine for a pilot. Configure S3 (SeaweedFS in Tashkent, or Cloudflare R2
for testing) before scaling. Audio upload is Phase 2.

## Design overhaul (IKHIMI_DESIGN_OVERHAUL_PROMPT) — deviations and open items

**J. Display font is PT Serif, not Literata.** The mandatory glyph check (`packages/ui/scripts/check-glyphs.ts`,
runs in CI) found Literata has no **Ҳ/ҳ**, so the spec's fallback applies. PT Serif lacks the Uzbek **ʻ**, so that
single glyph falls back to Inter (already loaded). The check verifies the whole stack.

**K. Some spec colours failed WCAG AA and were darkened** (`--ink-400`, `--orange-700`, `--warn-600`,
`--success-600`, `--error-600`, measured ratios noted in `tokens.css`). `scripts/check-contrast.ts` computes every
text pair from the token file in both themes and fails CI below 4.5:1. Text on orange stays dark in both themes
(the spec's `--ink-800` turns light in dark mode).

**L. Sounds are synthesised with Web Audio instead of an audio sprite.** 0 KB to download, nothing on Save-Data,
retuned by editing numbers in `packages/ui/src/sound.ts`. If recorded marimba/woodblock samples are preferred
later, only the cue functions change.

**M. Instant feedback locks the item.** Once a student taps "Tekshirish" and sees the answer, that answer can't be
changed (otherwise the key is one tap away). Teachers who choose "Javoblarni ko'rsatmaslik" get right/wrong only.

**N. Not built yet from the design spec:** Storybook (a live component page is the substitute idea — not done),
drag-and-drop for matching/ordering (tap-to-select/tap-to-place is implemented, which the spec requires anyway),
photo avatar upload, phone-number change flow, PDF data export (JSON is done), the 12-second landing video,
size-limit/Lighthouse budgets in CI, grading queue and courses screens (their features are Phase 3–4).
Account deletion requires a sign-in within the last 10 minutes instead of a fresh OTP; the 30-day purge job
isn't written yet.

## Pedagogy retrieval (§8.5)

**O. Methodology embeddings use Gemini, not a self-hosted model**, despite `EMBEDDING_DIMENSIONS`'s comment
in `schema.ts` saying "self-hosted." Methodology text (PPP, CEFR-age bands, distractor rules, etc.) contains
no personal data, so the data-residency rule that motivates self-hosting elsewhere doesn't apply here — and
it reuses the `GEMINI_API_KEY` already required for generation, so there's no new infra or cost to stand up
before Phase 1 ships. `GeminiEmbeddingProvider` (`packages/ai/src/llm/gemini.ts`) requests 1024-dimension
output via `outputDimensionality`, matching `EMBEDDING_DIMENSIONS`. Revisit if a self-hosted embedding
model is added for other reasons later — the `EmbeddingProvider` interface is provider-neutral.

**P. Retrieval fetches by `subject` match, not full CEFR/age filtering.** `retrieveMethodology`
(`packages/pedagogy/src/retrieve.ts`) filters to the teacher's first `teacherProfiles.subjects` entry (or
`'language-learning'`) OR `'cross-subject'`, then ranks by cosine similarity to the teacher's message —
there's no `age` field anywhere in the schema yet (groups/assignments only carry `cefrLevel`), and the
composer intentionally lets a teacher generate before picking a group (§10.2), so no age signal exists at
generation time to filter on. `04-cefr-age-bands` still gets retrieved when its content is semantically
close to the request text (e.g. the teacher mentions an age or a young-learner topic).

**Q. Only 6 starter docs are seeded** (`packages/pedagogy/content/methodology.json`): PPP, spaced
repetition/interleaving, Bloom's taxonomy, CEFR-age bands, distractor design, listening-task structure.
Two of these (listening, and part of CEFR-age's audio-level guidance) won't see real use until Phase 2 adds
`listen_*` exercise kinds. The distractor and retrieval-practice rules already existed as inline bullets in
`generate.ts`'s hardcoded system prompt before this change — those were deliberately left in place rather
than removed, so there is some intentional redundancy between the hardcoded prompt and the retrieved notes
until someone verifies removing the hardcoded versions doesn't regress quality.

**R. No re-ranking or usage feedback loop yet.** Retrieval always returns up to 4 docs ordered by raw
cosine distance; it doesn't yet use per-doc edit/delete signal from teachers (the eval harness in §8.7 is
the intended place to build that once there's real usage data). Every Vercel deploy runs the seed
(`vercel-build`, `--optional`): only new or changed docs are re-embedded, and a seed failure never fails the
deploy. `pnpm pedagogy:seed` does the same by hand. Until the table has rows, retrieval skips its embedding
call, so generation costs no extra Gemini request.

## Groups as the organising unit

**S. Every homework is published into a group.** Publishing asks "Existing group" or "+ New group"; a new
group takes a name plus optional level, start date, planned number of students and a note (schedule, room).
These details are for the teacher's organisation only and never reach the AI. The old "no group" option is
gone from the publish sheet (old ungrouped homework shows under "Guruhsiz"). Each group has its own page
(homework with results, students, editable details); Reports can be filtered by group, and a student's
"My work" is grouped by group and teacher. *Courses* (a paid, ordered series of lessons) will sit above
groups in Phase 3.

## Digitizing books and listening (T–W)

**T. Two composer modes.** "Yangi mashq yaratish" writes new homework as before. "Kitob mashqlarini nusxalash"
(called "Kitobdan raqamlashtirish" until BM: teachers didn't know the word) copies the book's own exercises word for word, keeping its numbering and order. Nothing is trimmed for time, and
nothing is invented. Answers come from an attached answer-key page, or else the AI solves the item and marks it
"Javob AI tomonidan topildi — tekshiring". Exercises that can't be auto-graded (essay, speaking, drawing, pair
work) are listed on the draft as "Nusxalanmagan mashqlar"; they are never turned into something else. Answer
pages have their own button since BM.

**U. Listening needs the real recording.** Book listening items are written with their full structure and the
book's label ("Track 1.12"), then held as "Audio kerak" (needs audio). The teacher uploads audio files, and a file
whose name carries the same numbers ("Track 1.12.mp3", "CD1_12.mp3", "ex3.mp3") is linked automatically;
otherwise the teacher picks the exercise. The AI then listens, **refuses a recording that doesn't fit the
exercise**, and takes the answers from what is said. Publishing is blocked while any listening item has no audio.
The same works in create mode: an attached recording becomes listening items about it. Students get a native
audio player; the stream route supports Range requests (Safari and seeking).

**V. At most 6 book pages per request.** Photos and PDF pages count together. A PDF longer than 6 pages needs
a page range ("12-14"), and only those pages are sent to the model. The ranges are PDF page numbers, not the page
numbers printed in the book.

**W. Open limits.** On Vercel without S3, each file is capped at 4 MB, which is about 4 minutes of MP3; longer
audio and any video need object storage (Cloudflare R2 is recommended: S3-compatible, with no egress fees).
Gemini accepts about 20 MB of inline data per request. Word (.doc/.docx) files upload but aren't sent to the
model yet; ask teachers to use PDF.

## Online courses and payments (X–AB)

**X. Courses are built from lessons.** Each lesson has a title, a YouTube or Vimeo link (we store only the link,
shown as a privacy-friendly embed), notes and optionally one of the teacher's published homeworks. Any lesson can
be a free preview. A course is **Yopiq** (private: the teacher and linked groups only), **Havola orqali** (unlisted:
anyone with the link) or **Ochiq katalog** (listed publicly on `/courses`). Public pages are `/course/<slug>`.

**Y. The price is a one-time purchase with lifetime access** (0 = free). Monthly subscriptions aren't built yet.
Students of groups linked to a course get it free. Homework that belongs to a paid course opens only for buyers,
for the homework's own group, and for the teacher; anyone else is sent to the course page.

**Z. Payments are ready to connect.** Everything goes through one flow: a pending subscription plus a payment row
priced by us, then the provider confirms by our payment id, then access opens. Confirmations are idempotent, and a
refund removes access. **Payme** (Merchant API: Check/Create/Perform/Cancel/CheckTransaction/GetStatement, amounts
in tiyin, Basic auth) and **Click** (SHOP-API Prepare/Complete with the md5 signature) are implemented from their
public specs and switch on when their keys are set. ⚠ Both must pass each provider's sandbox tests before going
live. Until then a **test provider** simulates checkout; it is on in development and in production only with
`PAYMENT_TEST_ENABLED=1`, and test payments never count as revenue.

**AA. Platform commission** is `CONFIG.platformCommissionPercent`, 0% until decided. It is recorded on each payment,
and payouts to teachers aren't automated. *Decide:* the commission, and how teachers get paid (the platform's
merchant account with payouts, or each teacher's own merchant account).

**AB. Refund policy isn't decided.** Refunds already work technically (a Payme CancelTransaction after payment,
or a Click cancel, removes access), but there is no in-app refund request yet.

## Sound, icons and fonts (AC–AE)

**AC. Sounds come from UI SFX** (github.com/romainsimon/uisfx: MIT code, CC0 audio). Its runtime synthesises every
cue in the browser, so students download no audio files. Homework uses the "arcade" pack by default, and learners
can switch to Quvnoq, Billur, Yumshoq, Tabiiy or Sokin in their profile (with a preview). Teachers hear the
near-silent "minimal" pack. Each interaction has its own cue: select, deselect, snapping a match, placing an
item in order, right, wrong (soft), a streak from 3 right in a row, submit, and a result fanfare by score tier.
Gap-fill typing is silent.

**AD. Icons.** The UI chrome keeps Lucide (the same set as the suggested `lucide:*` Iconify icons). Homework uses
colourful Fluent Emoji (Iconify `fluent-emoji-flat`, MIT), **bundled at build time** (`pnpm --filter @ikhimi/ui
icons`) instead of the `iconify-icon` CDN script. The script fetches every icon from api.iconify.design at runtime,
which is slow on 3G and leaves icons blank offline. We ship the same icons, about 10 KB gzipped for all 31.

**AE. Fonts.** Inter was already the UI font, self-hosted through `@fontsource-variable/inter` (every weight,
Cyrillic included). The Google Fonts `<link>` would add a third-party request for the same font, so it isn't used.

## Legal pages and support (AF–AG)

**AF. Privacy policy, terms/public offer, About and Help exist as drafts** (`/privacy`, `/terms`,
`/about`, `/help`) in 4 languages, written from what the product actually does. Facts that change
(operator, contact, retention, commission, hosting, refund policy, version) live in `apps/web/src/content/site.ts`,
so the pages follow any change. Placeholders still to fill: **company name and tax ID (STIR), legal address,
support email, refund policy, commission, teacher payout method, and data localisation (#1)**. Sign-in shows
"by continuing you accept…", and buying a course requires ticking the public offer; the accepted version is stored
on the payment. When a feature touches data or money, update these texts and bump `legalVersion`.
⚠ A lawyer in Uzbekistan must review the texts before launch.

**AG. Support runs on the existing 익히미 bot.** One webhook, two jobs: `/start <login token>` and shared contacts
go to login, and every other private message is a support conversation. It is copied into the admin chat
(`SUPPORT_ADMIN_CHAT_ID`, a person or a group) under a header naming the sender, and an admin replies with Reply to
send the answer back; photos, voice and files work too. `/id` tells any chat its id. With no admin chat set,
support messages are ignored. Optionally, a separate support bot can take over by setting `SUPPORT_BOT_TOKEN`
(webhook `/api/telegram/support`).

## Teacher-first generation, AI-graded writing, progress analytics (AH–AL)

**AH. In Create mode the teacher's request is the specification.** If they name a number of items or sentences,
the kinds, skills, topic or order, the AI does exactly that; the pedagogy defaults only fill what they left open.
When they set a count (`teacherSetCount`), the time budget no longer trims items. Item time now scales with size
(`estimateSeconds`: per blank and answer length for gap-fill, per pair/item, per sentence for writing, plus the
passage's reading time), so a 15-sentence drill is timed honestly. **Digitize mode is unchanged**: its schema has no
writing kind and no passages, and anything like that the model returns is dropped.

**AI. Transformation drills and reading.** "Make N sentences, then negative and question" becomes one gap-fill per
base sentence with a whole-sentence blank per transformation, every correct variant listed (auto-graded). Reading
is a passage (`passages[]`, 80–250 words, original) plus 3–6 questions that refer to it; the passage text is stored
in each item's payload (`payload.passage`) and shown above the question. No schema migration. Three matching
methodology notes were added to `methodology.json`; run `pnpm pedagogy:seed` to embed them.

**AJ. `open_writing`: students write their own sentences, the AI grades them.** Payload: number of boxes (1–20)
and a student-facing checklist; key: a hidden rubric and model sentences. `gradingMode: 'ai'`. The AI grades at
check time (one call per item) or at submit; per sentence it returns ok/not, a minimal correction and one line of
feedback in the instruction language, plus a summary (`responses.aiFeedback`, JSON). Points = sentences (max 10)
× fraction acceptable; the item counts as "right" for streaks and skills at ≥ 80 %. The student's name is stripped
and the prompt treats their text as data. **If the AI can't grade, nothing is guessed**: at check the answer stays
saved and unlocked; at submit it stays pending, the attempt waits in `submitted` (`manualPendingCount`) with a
provisional score, and the report offers "grade again" or manual grading. The teacher can override any answer
(points, per-sentence verdicts, a note to the student); `finalizeAttempt` recomputes the score. Submit claims the
attempt first, so a double tap can't grade (and bill) twice. Cost: one extra AI call per student per writing item.

**AK. Progress analytics.** `/app/students/[id]`: a student's results over time against the class average, place
per homework and in each group, on-time rate, trend (last 3 vs previous 3, ±5 points = steady), skills vs class,
AI writing feedback, and missing homework. The group page adds class average over time, the spread of students,
weakest skills, and a ranked student list with sparklines, each linking to the student page. Charts are small
server-rendered SVGs (`packages/ui` `charts.tsx`) with hidden data tables for screen readers; no chart library.

**AL. Privacy of results (applies #4).** A teacher sees only students in their own groups, and only homework they
set. A student sees their own results and class **averages**, never a classmate's name or score. They see their own
place in the class only when the teacher turns on "Students see their place in the class" for that group
(`groups.students_see_leaderboard`, off by default).

## Exam styles and essays (AM–AN)

**AM. Exam-style homework (Create mode only).** The composer has a **Language** chip (guessed from the teacher's
words, then file names, then the language of their recent homework, then profile subjects; always changeable) and
a **Style** chip listing only that language's exams, plus a **Level** chip. The catalog (`packages/ai/src/exams.ts`,
data only, also imported by the browser as `@ikhimi/ai/exams`) covers English (IELTS Academic, IELTS General
Training, TOEFL iBT, Cambridge A2 Key–C2 Proficiency, Milliy sertifikat CEFR Multilevel), Russian (ТРКИ), Korean
(TOPIK I/II), Chinese (HSK), Japanese (JLPT), German (Goethe, TestDaF), French (DELF/DALF), Spanish (DELE),
Turkish (TÖMER/TYS) and Arabic (CEFR-aligned). Each exam maps its real task formats onto our item kinds and
carries its writing tasks and official writing criteria. The server rejects an exam that isn't the chosen
language's (`server/exam-style.ts`), so an Arabic style can never be used for English. The exam is stored in
`generationMeta` and kept by revisions and single-item regeneration. Digitize mode ignores all of it. We write
original items in the exam's style, never past papers. Subjects now include these languages.
⚠ Each exam entry must be reviewed by a tutor who teaches it before we advertise it. Details most worth checking:
the TOEFL iBT 2026 task names, the Multilevel writing tasks, and the DELE/DELF/Goethe/TÖMER criteria scales.

**AN. `essay`: one long text, graded on the exam's grid by the AI or the teacher.** The item stores the exam's
criteria and scale (IELTS 4 × 0–9, overall to half bands; Cambridge 4 × 0–5 = /20; TOPIK 54 12/12/26 = /50;
characters instead of words for Korean and Chinese), the length limits, and who grades it (AI by default; the
teacher can choose "I will grade it myself", stored as `gradingMode: 'manual'`). The AI returns a score and reason
per criterion, strengths, improvements and corrections; **the overall is computed in code with the exam's
rounding** (IELTS .25/.75 round up), never taken from the model. An essay is worth 10 points (fraction =
overall/max); it counts as "right" at 60 %. Teacher-graded essays are never sent to the AI and wait in the report;
the teacher enters a score per criterion and the points follow. Essays and writing tasks are never trimmed for
time. JLPT and TOPIK I have no writing section, so no essays are offered in their style. Speaking and other tasks
that need a recording or live interaction are left for later.

## Built for a paid, strongest model (AO)

**AO. The AI is no longer sized for the free tier.**
- **A model per task.** Every call names its task: `generate`, `review` (item checking and repair, solve-back,
  listening audio match), `grade` (essays, own sentences) or `fast`. `GEMINI_MODEL_<TASK>` picks each model and
  falls back to `GEMINI_MODEL`, then `GEMINI_FALLBACK_MODELS`, when it is busy. On the paid plan, put the strongest
  model on generate, review and grade.
- **Thinking.** `GEMINI_THINKING=level` sends Gemini 3's `thinkingLevel` (high for writing and judging, low for
  mechanical checks); `budget` sends Gemini 2.5's `thinkingBudget`. The default `off` keeps today's behaviour
  until the paid model is connected.
- **Review and repair pass (Create mode, `AI_REVIEW=1`).** After generation a senior-examiner call sees every item
  with its key, the materials, the teacher's request and the exam style. It returns keep, fix (with the corrected
  item, which goes through the same conversion and checks) or drop. It never drops items when the teacher set the
  count and never removes the whole homework; in those cases the item is flagged with the reviewer's note (stored
  in `exercises.rationale`, shown on the draft). If the review call fails, the draft stays as written. Digitize
  mode is untouched. Solve-back still runs afterwards as an independent check.
- **Limits.** Book pages per generation are `CONFIG.maxMaterialPages` = 12 (was 6).
- **Cost and time.** The review roughly doubles the cost of each generation. With a slower, thinking model, the
  longest homeworks may approach the 300 s function limit (`maxDuration` on `/api/generate`); if that happens,
  raise it on a Vercel plan that allows longer functions, or set `AI_REVIEW=0`.
- The PII guard (`assertNoPII`, name stripping) stays whatever the tier: it's good practice and our privacy
  policy promises it.

**AP. One output schema per item kind (fix for empty homework, 2026-09-30).** With a single flat item schema,
where every field was optional for every kind, the paid model on long requests (30 minutes plus a 15-sentence
drill) left out the answers (`gap_fill` without `gapAnswers`) and filled irrelevant fields with junk, so every
item was rejected. Each kind now has its own schema (`anyOf`) with only its fields, and its answer fields are
required. Other fixes from the same investigation:
- With `GEMINI_THINKING=level` no temperature is sent (Gemini 3 wants its default).
- An empty `exercises` reply is retried once.
- A number the teacher gives covers that part; the rest of the time is filled from the materials.
- The review pass runs at low effort with a 16k output cap. It is skipped if the draft took over 120 s, so the
  whole request stays inside the 300 s function limit. At high effort it ran to the 65k limit and took 262 s.

Verified against the production key with the teacher's real requests: 10–17 valid items, 53–153 s.

## Classroom feedback round (AQ)

**AQ. Changes after a real teacher and student test (2026-09-30).**
- **Pictures in exercises.** In Create mode, an item that needs a picture from an attached photo gets an
  `imageRef` (material number plus a 0–1000 box). The server crops it with sharp (`server/pictures.ts`), stores it
  as the teacher's image material and links it as `payload.imageId`. It is served by `/api/pictures/[exerciseId]`
  under the same rule as listening audio, and only from the assignment teacher's own materials. Pictures in PDFs
  can't be cut out yet (that needs a page renderer), so the model is told to describe them or write a different
  item; an unservable picture flags the item `image_missing`. Limits: a full-draft revision or a single-item
  regeneration loses the picture (no materials are sent then). Digitize mode is unchanged.
- **Same-type items share a page** in the student player (`lib/pages.ts`): consecutive items of one kind with the
  same reading text, at most 8 per page. The student answers them all and checks once; each item shows its own
  result, and the footer shows the page score. Essays and listening items keep their own page.
- **The teacher names each homework** on the draft page (`PATCH /api/assignments/[id]`), before or after
  publishing.
- **Homework is listed course by course** (a course = one of the teacher's groups). Teacher (Hisobotlar): drafts,
  then one section per course with its homework. Student (Mening ishlarim): their courses, each opening to its
  homework with status and score (`studentHomeworkByCourse`); homework opened from a link outside their courses
  comes last.

## Pictures cut out automatically, in both modes (AR)

**AR. Pictures are cut out like screenshots, in Create and Digitize, with no manual step (2026-09-30).**
Teachers are never asked to crop or pick pictures: 익히미 is one-click homework. The AI reads the materials,
chooses the exercises, and only for the chosen items that need a picture gives its location (`imageRef`). The
server cuts just that part out (`server/pictures.ts`). The whole file is never converted to images: the model
reads the original files as before, so AI tokens don't change.
- **Screenshot, not a perfect cut.** The box gets a 4 % margin so a rough box still holds the whole picture;
  plain white borders are then trimmed. A missing, reversed or tiny box becomes the whole page.
- **Never shown broken.** An item whose picture can't be cut (no such material, crop failure) is flagged
  `image_missing`, and `settlePictures` takes it out: Create drops it, Digitize lists the book exercise under
  "skipped" with the reason. If every item lacks its picture they stay, flagged, so a homework is never emptied.
- **Digitize copies the book's pictures too.** This changes decision AQ ("Digitize mode is unchanged"): copying
  a picture is copying the book. Exercises are never skipped or reworded because they have pictures.
- Students can tap a picture to see it full screen.
- **PDFs (AR, part 2).** For a PDF the model also gives the page (its position in the file as sent; a printed
  page number from a longer file is mapped back). The server draws **only that page** with pdf.js (Mozilla,
  Apache-2.0) and @napi-rs/canvas (`server/pdf-pages.ts`), at 2000 px on the long side, then cuts it like a
  photo: about 0.7 s per page on Vercel. Both libraries load only when a PDF picture is needed. The fonts,
  character maps, decoders and parser pdf.js reads from disk are shipped through `outputFileTracingIncludes`.
- **Word documents (AR, part 3).** Gemini can't read .docx, and the upload box used to accept Word files that
  were then silently ignored. Now mammoth (BSD-2) turns the document into simple HTML (text, lists, tables) and
  each picture in it becomes its own image, marked `[Picture N]` where it stands (`server/word.ts`). Icons under
  64 px and formats sharp can't open (EMF/WMF) are left out, and at most 24 pictures are sent per document. An
  item points at a picture by number (`imageRef.picture`) and gets that picture as it is. For the page limit,
  a document counts one page per 3,500 characters plus one per four pictures, so text is cheaper for the AI
  than the same pages as a PDF. Old binary .doc files are refused with a message asking to save them as .docx
  or PDF, both in the composer and on the server.
- **Revisions keep pictures (AR, part 4).** A draft revision or a regenerated item is written without the
  original files, so it can't cut a picture again (limit noted in AQ). `keepPictures` gives a regenerated item
  the picture of the item it replaces, and in a revision gives an item the picture of the earlier item with the
  same prompt, or else from the same book exercise (sourceRef). This runs before `settlePictures`, so a good
  picture item is never removed just because it was revised.
- **Picture exercises actually get written (AR, part 5, 2026-10-01).** A teacher asked for exercises on the
  pictures and got none. Causes found in the pipeline: the prompt said what to do *if* an item needs a picture
  but never to write picture items when asked, and it nudged toward describing pictures in words; the review
  pass wasn't told what imageRef means, so "What is in picture 3?" could look ambiguous and be rewritten or
  dropped; the review pass sent Word documents as empty files; solve-back, which can't see pictures, flagged
  picture items. Now: a request for picture exercises (or pages built around pictures) makes the model write
  them; the reviewer judges picture items by looking at the material and keeps their imageRef; the reviewer
  gets exactly the generation's material parts; solve-back skips picture items. Each generation logs
  `[pictures] model pointed at N of M items; K kept…` and `[pictures] attached A, removed R`.
- **A focused call finds the pictures (AR, part 6).** Production log for a Korean homework: "model pointed at 0
  of 20 items", while several items said "Look at the picture". Writing twenty items and giving coordinates in
  one answer is unreliable. Now every item that mentions a picture (picture/rasm/картинка/그림… in its text) and
  has no imageRef goes to `locatePictures`: one small call with the same materials that only decides whether a
  picture is needed and where it is. Found → imageRef; needed but not found → removed by settlePictures; not
  needed (e.g. "I took a picture" as content) → left alone. It runs before the review. Also: a gap_fill prompt no
  longer repeats the gap text (`withoutRepeatedLines`, plus a prompt rule).

## Admin panel (AS)

**AS. An admin panel for the owner and assistants (2026-10-01).** `/admin`, built from what the business needs
to see before teachers notice a problem.
- **Who gets in.** Owners are the phone numbers in the `OWNER_PHONES` setting: full access, and the only people
  who manage staff, so nobody can lock the owner out or grant themselves more. Assistants are added in the
  panel by phone number with a role; a role is a named set of permissions (health, growth, money, see users,
  show phone numbers, manage users, open homework, action log). They get the panel the next time they sign in
  with that number. For everyone else `/admin` doesn't exist (404). The `admin` user role in the schema is not
  used for this: staff access is separate from being a teacher or student.
- **Recent sign-in.** Admin pages need a session started in the last 12 hours; older sessions are asked to sign
  in again with the code.
- **Privacy.** There are no passwords (phone codes only). Phone numbers are masked in lists; showing one is a
  separate permission and is logged. Opening a homework (items, keys, pictures, scores) is logged. Every change
  (block, limits, free course access, staff and roles) goes to `admin_audit`.
- **Health data.** `generation_runs`: one row per homework generation with outcome, error code, time, items,
  pictures (pointed, located, attached, removed) and whether the review ran. A run still "running" after
  6 minutes was killed by the time limit and counts as a timeout. `ai_calls`: one row per AI call (purpose,
  model, input/output/thinking tokens, time), written by `metered()` around every model call. Cost is
  estimated from tokens with `AI_PRICES` (thinking billed as output); the Google bill is the final word.
- **User actions.** Block or unblock: a blocked account loses its sessions and can't sign in. Per-teacher daily
  generation limit (`teacher_profiles.daily_cap`) and "reset today's count" (`cap_reset_at`). Free access to a
  course for a student (a `staff_grant` subscription that staff can take back).
- **Load.** Pages read the database only when staff open them; the extra writes are one row per generation
  and one per AI call.

## Second pronunciation test (AT)

**AT. Fixes after the owner tested a Present Continuous / Present Simple homework (2026-10-03).**
- **Grammar items had a stray voice.** Listening and pronunciation parts may play a word or sentence (`speak`), but
  nothing said what it must be, so written grammar questions got the answer read aloud ("is waiting") above them.
  Now `itemProblem` (generate.ts) checks every Create item: the voice must say the word to choose or type, or the
  whole sentence whose missing words are filled in. A written question with a blank never gets a voice. A voice
  that doesn't fit is removed from a written item; an item that says "listen" and doesn't fit is written again.
  Listening parts with no recording got their own rules (listen and complete, listen and answer, dictation).
- **"The verb in brackets" with no brackets** is written again, and the writers and the reviewer are told to show
  everything a prompt mentions.
- **Only shadowing asks students to speak.** A typed or chosen item that says "repeat aloud" or "shadowing" is
  written again; pronunciation parts hold only mcq_single, short_answer and shadowing (others become dictation).
- Rejected items go back to the part's top-up call with the reason. A review fix that breaks these rules or no
  longer fits its sound keeps the item as it was.
- **Feedback.** A wrong answer says "Noto'g'ri" (not "Unchalik emas"). With answers hidden, a right choice is
  green; it used to turn red with ✕ because there was no key to compare it with.

## AI tutor and the VIP plan (AU)

**AU. The AI tutor explains wrong answers, as the first VIP feature (2026-10-03).**
- **What students see.** Under a wrong answer, an owl ("Ustoz") says why THEIR answer doesn't fit and what the
  rule is, in the instruction language, with one new example in the language being taught. One more press gives
  a different, simpler explanation ("Tushunmadim, boshqacha tushuntiring"); `CONFIG.vip.tutorNotesPerAnswer` = 2
  in all. Explanations are stored on the response (`responses.tutor`), so a reload or a second press costs nothing.
  *Changed 2026-10-07: the live tutor (buttons, no typing).* Under the first explanation the student gets three
  buttons: "Tushunmadim" (simpler, a new angle), "Yana misol" (one more example) and "Mashq qilaman" (one small item
  on the same rule: pick one of 2-4 options or fill one blank, plain text only). Each press is one AI reply that sees
  everything said before; `CONFIG.tutorNotesPerAnswer` = 5 (the explanation + 4 presses), then "Keyingi savolga
  o'tamiz 👍". No typing, because many students are young children: no off-topic chat, nothing to moderate, a known
  cost. The practice item is checked on the server with the homework's answer rules, one try (a wrong try shows the
  answer and why, in orange, never red), and never scored; its answer reaches the browser only after the try. With
  hidden answers, a practice item that contains the exercise's answer is refused.
- **Hidden answers stay hidden.** When the teacher chose "never show answers", the right answer is not sent to the
  model, the tutor is told to guide without giving it, and if it still writes it, it's masked and the example
  dropped.
- **Kinds.** Items with one checkable answer (choice, true/false, gap fill, matching, ordering, short answer).
  Written work and essays already have their own AI feedback; shadowing has its tips.
- **Who gets it.** Students on the VIP plan (see AV; at first a VIP teacher's students got it too, replaced by
  packages). Everyone else sees the homework's own explanation in the same card and voice.
- **Look.** The tutor speaks in Nunito italics (checked for every Uzbek letter), apart from the exercise text. The
  owl is a placeholder: `TutorAvatar` has the moods (idle, thinking, talking) an animated mascot will use.
- **Cost.** One small call per wrong answer the student opens, recorded as purpose `tutor` on the admin health page.
- **Also fixed:** the Uzbek Cyrillic generator wrote yo'q as ёъқ; it's йўқ now (every "… yo'q" message).

*Decided in AV:* plans belong to students; teachers buy them for their students as packages.

## Student plans: Free, Pro, VIP (AV)

**AV. Teachers create with everything for free; the STUDENT's plan decides what they see (2026-10-03).**
- **What each plan includes** lives in one list (`packages/ai/src/plans.ts`): Free = vocabulary items; Pro =
  everything except voice work; VIP = everything, with shadowing, the AI tutor, speaking later and every future
  feature. A new feature is one line there.
- **How it's enforced.** When a student opens homework the server works out their plan and sends only the items
  it includes; a locked item can't be checked or scored (403). Submitting records the plan on the attempt
  (`attempts.plan`) and the score counts only those items, so a Free student who gets every word right scores
  100%. Attempts from before plans (`plan` null) keep every item.
- **Teaser.** One line on the first and last page and on the result page: "Bu vazifada yana: Pro tarifida 6 ta
  mashq · VIP tarifida 1 ta mashq. Tariflarni ko'rish". A homework with nothing on the student's plan shows a lock
  screen with the way to the plans, never an empty page.
- **Where a plan comes from.** `subscriptions` rows with plan `pro`/`vip` and no course: the student's own
  purchase (Payme/Click, `/plans`, 1/3/6/12 months, a second purchase runs on after the first), a seat in a
  teacher's package, or staff (admin panel: Pro/VIP +30 days, take back). The best active one counts.
- **Teacher packages** (`plan_packages`, `/app/packages`): N places × months of Pro or VIP for one class. A
  student of that class takes a place when they open homework, until places run out; a student who already has
  as good a plan doesn't use one. A refund takes the places back. Staff can also give a teacher a free package.
- **Teacher report** shows each student's plan, and items outside it as "🔒 not shown to this student".
- **Prices**: see AZ (Pro 59 000, VIP 89 000 so'm a month, period and teacher discounts, edited in the admin
  panel). A plan without a price still says "the price will be announced soon" and shows no buy button.
- The old `users.vip_until` is gone; VIP given with it carries over as a staff-given VIP plan.

*Decide:* whether the leaderboard should compare only students on the same plan (today it compares percentages).

## Answer checking per language, and "the teacher accepts it" (AW)

**AW. Typed answers are compared the way a teacher of that language would (2026-10-04).** The homework's
language picks the rules (`packages/ai/src/answer-lang.ts`); other languages keep the old ones.
- **Korean:** spacing and punctuation don't count (학교에 가요 = 학교에가요).
- **Chinese:** traditional = simplified (學習 = 学习; opencc-js, MIT/Apache-2.0, loaded on the server only, never
  in students' browsers), spaces and full-width punctuation don't count; pinyin compares letters and tones in
  order, so tone marks = tone numbers (nǐ hǎo = ni3hao3), and missing or wrong tones are still wrong.
- **Japanese:** full-width = half-width, hiragana = katakana, spaces don't count. Kanji vs kana is left to the
  answer list.
- **Arabic:** vowel marks and the stretching line don't count; أ/إ/آ/ٱ = ا, ة = ه, ى = ي; Arabic digits = 0–9.
- **No typo forgiveness in Korean, Chinese and Japanese.** One character there is a syllable or a word, often the
  grammar being tested (갔어요 / 갈어요 differ by one letter). This replaces the earlier idea of counting Korean
  typos letter by letter, which would have let exactly that through.
- **What the AI lists** (Create mode only; Digitize is frozen): per-language rules for accepted answers — Korean
  speech styles and interchangeable particles, simplified Chinese and tone-marked pinyin, Japanese kanji and kana
  spellings and both styles, Arabic without vowel marks. The writers, the vocabulary writer and the reviewer get
  them.
- **"Teacher accepts it."** In the report, under a typed answer marked wrong (a short answer, or each wrong gap),
  the teacher taps "«…» ham to'g'ri". The answer joins the item's accepted answers, every student who wrote it is
  re-scored (handed-in work gets its new total), and later students get it right. Answers the teacher graded by
  hand keep the teacher's grade.

## The Research lab and the methodology library (AX)

> Replaced by BG (2026-10-17): the Lab no longer makes method cards; each methodology has one body of knowledge.

**AX. Staff teach the tool textbook methods by hand; nothing learns on its own (2026-10-04).** An earlier version
learned after every Digitize; it was dropped before release to keep load off the system (the owner's call:
side features must never weigh on the platform). Digitize does only its own job.
- **Research lab** (admin panel → Tadqiqot laboratoriyasi, permission `methods`). Staff upload the pages where a
  book's authors explain their method ("How to use this book", "Introduction", the teacher's book notes; up to 12
  photos or PDFs) and fill in what they know (book, language, level, age, subject, a note on what to focus on).
  One AI call reads them and writes method cards: one per lesson type the authors describe (its stages in order,
  what each trains, the style of instructions, how support fades) and one for the book's general principles.
  What staff typed wins over what the model read. Methods the pages don't describe are never invented.
- **Only the method is kept,** in our own words; never the book's text, examples or pictures. The uploaded pages
  are deleted once read. A method another book repeats is counted ("found in N books"), not added again.
- **Nothing is used until staff approve it.** The library under the lab: filter by status, language, level, age,
  subject, book or a search; "Yangi" marks cards nobody has looked at; approve ("Yaratishda ishlatish"), reject,
  stop, put back to waiting, or reword the title and the guidance the AI gets. Every action is logged.
- **Create mode** gives the planner and the writers up to three approved cards in the homework's language within
  one CEFR level, most confirmed first, under "the teacher's request always comes first". Each use is counted.
- **Load:** one AI call per press of "O'rganish", nothing else. This is how the pipeline "learns": approved methods
  go into its instructions; the model itself is not retrained.

**AY. The Research lab learns from any outside source; the planner picks a method per part (2026-10-05).**
- **Sources:** a book's methodology pages, an app's screens (e.g. Duolingo), an article (PDF or pasted text), or
  anything else (workshop slides, colleagues' methods). Each card records its kind of source and its name. For app
  screens the AI maps each mechanic onto our exercise kinds (word tiles → ordering, tap the pairs → matching, type
  what you hear → short_answer with sound, say it → shadowing) and says what is lost where there is no close
  equivalent. Brands, characters and the source's text are never kept, and writers are told never to name or
  imitate the source to students.
- **Choosing methods:** the planner gets a menu of up to 8 approved methods in the homework's language within one
  CEFR level. A source the teacher names ("Duolingo uslubida") comes first; the rest are shuffled so homeworks
  vary. The planner may give each part one method (or none where nothing fits); the plan card shows it ("Usul: …")
  and the teacher can remove the part as before. Each part's writer gets only its own method. A method counts as
  used when a homework is written with it.
- **Load:** still one AI call per press of "O'rganish"; the menu adds a few lines to the planning call; writers get
  one method each instead of three.
- **The Lab is in English (2026-10-05).** The owner works there, and English is what the AI reads best: the page is
  English whatever the panel's language, the tab is called "Lab", and new cards' titles and summaries are written
  in English (so the method name a teacher sees on the plan card is English too). Cards made earlier keep their
  Uzbek wording until edited.
- **The Lab is the owner's private workshop (2026-10-05).** Only owners (OWNER_PHONES) can open it or its API; it
  is no longer a permission a staff role can be given. Teachers never see a method: the plan card shows no method
  line, and the plan sent to their browser carries only an opaque id. Students never see it either (writers are
  told never to name a source). Methods only shape the homework from behind.

## Prices, teacher packages, commission, and no course sales (AZ)

**AZ. Simple prices the owner can change; 익히미 sells plans, never courses (2026-10-07).**
- **Prices.** Pro 59 000 so'm and VIP 89 000 so'm per student per month. Buying more months at once: 3 months
  −10%, 6 months −15%, 12 months −25%. One function (`planTotal` in `packages/ai/src/plans.ts`) prices every
  order, on the server and in the checkout; totals are rounded to 100 so'm.
- **Teacher packages are always 10% cheaper**, added to the period discount: 1 month −10%, 3 months −20%,
  6 months −25%, 12 months −35%, for every seat.
- **Why 10%: the teacher's commission.** When a student buys a plan themselves, 10% of the payment is credited to
  their teacher: only a teacher whose class the student is in (the class joined most recently). A student in
  nobody's class earns nobody a commission. It is recorded on the payment (`payments.commission_teacher_id`,
  `commission_krw`); a refund takes it back. A teacher buying a package gets the 10% as the discount instead.
- **Teachers see their earnings** on "Daromadim" (`/app/earnings`): this month, all time, how many students
  bought, and each payment (student, plan, months, amount, their share). Admin → Money lists every teacher's
  total. Paid out by hand by the 익히미 team for now. Real paid payments only (test payments don't count).
- **The owner edits the prices** in Admin → Money → Plan prices: the monthly prices, the discount per period, the
  teacher's discount and commission, and the VIP gift's last day, with a table of what every order will cost.
  Saved in `app_settings` (key `pricing`), logged in the staff log; staff with the Money permission see them,
  only the owner can save. Until the first save the defaults in `CONFIG.pricing` apply.
- **VIP gift.** Every student who registers until 31 December 2026 (end of the day, Tashkent) gets 7 days of VIP
  from registering (a new student account, or an existing account that becomes a student); then they are on Free
  until they pay. The last day and the number of days are set in the admin panel. Students who registered before
  this was added get nothing automatically (the owner manages them from the admin panel).
- **No course sales** (replaced by BL on 2026-10-20: courses can be paid now). Teachers don't set course prices and
  there is no course checkout; courses are free inside 익히미. A teacher who sells a course does it their own way (the platform helps them sell it, they earn more)
  and gives buyers access by linking a private course to their class. Old course price data is kept in the
  database but ignored. The terms of use (version 0.2) say so, and describe plan payments and the commission.


## Reminders, mistakes review, parents, copies, alerts, evals (BA)

**BA. Eight follow-ups that make the platform work harder without more AI load (2026-10-08).**
- **Telegram messages to students** (`server/notify.ts`). Students whose Telegram is linked (they signed in with
  it) hear about new homework when it's published or copied into their group, and at 18:00 Tashkent about homework
  due within 30 hours they haven't handed in. The teacher's report has "Telegramda eslatish" for everyone of the group
  who hasn't handed it in (once a day per student; it says how many have no Telegram). When the teacher grades the
  last answer that was waiting (an essay), the student hears their result. Each student's switches in Profile →
  Notifications are kept; every message goes out once (`notification_log`, keys kept 60 days).
  *No website link* in these messages until the owner turns "Homework link in messages" on in Admin → Health →
  Telegram messages; until then they say where to find the homework.
- **The daily job** is `GET /api/cron/daily`, called by Vercel Cron at 13:00 UTC (`apps/web/vercel.json`). It needs
  `CRON_SECRET` set in Vercel (Vercel sends it; without it the job refuses to run, and Admin → Health says so). On
  the Tashkent VPS, a system cron calls the same URL with `Authorization: Bearer <CRON_SECRET>`.
- **Alerts to the owner** in Telegram, at most one per topic an hour: an API route answering 500, a page or route
  crashing (`src/instrumentation.ts`), 5+ AI failures in 15 minutes that are half the calls or more, a daily-job
  step failing. They go to `ALERT_CHAT_ID`, else the owners' own Telegram (OWNER_PHONES who signed in with Telegram),
  else `SUPPORT_ADMIN_CHAT_ID`.
- **Work on mistakes** ("Xatolar ustida ishlash", `server/review.ts`). A wrong answer on an auto-graded item (choice,
  gaps, matching, ordering, short answer) comes back 3 days after the homework was handed in; right moves it to 7,
  then 21 days, then it is learned; wrong brings it back in 2 days. The same item, no AI, never scored, never in the
  teacher's results. Only items of the student's plan; answers stay hidden where the teacher hid them. Mistakes of
  the last 60 days join the list when the student opens My work.
- **Parent link** (`/parent/<token>`, `server/parents.ts`). A teacher makes it on a student's page and sends it
  themselves; it shows only that teacher's homework: average against the class average, done and on time, trend,
  homework not handed in, each result, skills. First name only, no ranks or classmates. Not indexed; the teacher
  turns it off or replaces it at any time. *Decide:* mention parent links in the privacy policy.
- **Give to another group.** A published homework can be given to another of the teacher's groups (or a new one):
  a copy with its own link, due date and results, the same items, pictures and recordings, nothing generated.
- **Practice on a weak skill.** The group page lists up to 3 skills the group gets under 80% right (at least 5
  answers). One click opens Create with a request already written: the skill, the level, the items most often wrong
  with the right and the most common wrong answer (never a student's name). The teacher reads it, edits it if they
  like, and sends it. Create mode only.
- **Accounts deleted 30+ days ago are erased** (`server/purge.ts`, daily job), as the privacy policy says: name,
  number, Telegram, settings, profile details, sign-in traces, a student's answers, a teacher's chat with the AI.
  Payment records stay (law); a teacher's published homework stays without their name, since students did it.
- **Generation evals** (`evals/`): 11 real-style requests (Uzbek Latin and Cyrillic, Russian, English; teaching
  English, Russian, Korean, Arabic) through the real Create pipeline, checked for language, exact counts and kinds,
  every item written, no rule-breaking item, instruction script; time and solve-back reported, solve-back gated at
  95% over the suite. `pnpm --filter @ikhimi/evals eval`; about 100 AI calls a run.
- **Chat boxes** (Create's composer and the draft's "ask for changes") start three lines tall and grow to 10 and 8.

## Teacher and student sides of one account (BB)

**BB. Dual roles stay possible, but no role is ever added silently (2026-10-09).** Replaces E ("the first sign-up
path creates teachers") and the old rule that signing in or opening homework added a role.
- **Signing in never adds a role.** An existing account opens in the role the way in asked for if it has it (a
  homework link asks for student), else the one it used last, else its first role.
- **A new account chooses once.** Coming in through a homework or course link makes a student. Any other way in
  (the header's "Kirish", the home page) ends on the welcome screen: "Men o'qituvchiman" or "Men o'quvchiman", then
  the name (and subject for a teacher). Until then the account has no roles (`roles = []`) and every page sends it
  back to the welcome screen; the VIP gift or teacher profile comes with the choice.
- **Adding the other side is deliberate.** A student adds the teacher side in Profile ("O'qituvchi sifatida ham
  ishlash"); a teacher opening someone's homework is asked "Bu vazifani o'quvchi sifatida bajarasizmi?". Nothing else
  adds a role (`/api/profile/role` with `add`).
- **The open side is always shown** next to the avatar (O'qituvchi / O'quvchi); switching asks once more. Doing
  homework opens the student side.
- **Staff can correct roles** in Admin → Users (at least one; homework and groups are kept), e.g. for students the
  old default made teachers.

## Group ranking (BC)

**BC. One ranking per group, recalculated after every homework (2026-10-09).** `server/ranking.ts`.
- **Score:** the average over the group's homework that counts for the student. Homework they didn't hand in counts
  as 0% once it's closed: its due date has passed, or, without a due date, a newer homework was published in the
  group. Homework published before they joined counts only if they did it. Ties: more homework on time, then
  whoever finished their last one first. Nothing counted yet: no place.
- **Recalculated on every view**, so it moves with each homework; ▲/▼ shows places gained or lost since the latest
  homework. No monthly reset.
- **Teacher:** the group page's student list is the ranking (🥇🥈🥉, change, done/counted, score).
- **Students:** where the teacher turns "Students see the group ranking" on, My work shows the whole list with
  every classmate's place and score, as first name + last initial (their own row in full and highlighted). Off by
  default. The student's own place on their profile uses the same score.

## The iOS app (BE)

**BE. A native iPhone app around the site, made to pass App Store review (2026-10-10).** `apps/ios`, README there.
- **Native, not a bare wrapper (rule 4.2):** Sign in with Apple, push notifications, camera and photo picker,
  microphone for pronunciation, the share sheet, downloads to the share sheet, links to the site opening in the app,
  pull to refresh, a native "no internet" screen.
- **Nothing sold in the app (rule 3.1.1):** it opens `/open/ios`, the same no-purchase mode as the Play app
  (`isStoreApp`): no plans, packages or "see plans" links; plans bought on the website still apply. Nothing about
  Android either (rule 2.3.10).
- **Sign in with Apple (rule 4.8),** shown first, in the app only. The account's phone column is `apple:<Apple user
  id>` (like `deleted:` for erased accounts), so all sign-in code is shared; Apple's refresh token is kept only to
  revoke it when the account is deleted (rule 5.1.1).
- **One person, one account** (`server/auth/link.ts`). An account made with Apple can link Telegram: in Profile, and
  on the welcome screen of a new Apple account ("Signed in with Telegram before?"). A number nobody uses joins the
  account. A number that already has an account wins: the Apple ID moves there and the new Apple account is closed
  (erased after 30 days), as long as it has no work in it (homework, answers, classes, courses, a paid plan; the free
  welcome gift doesn't count). Two accounts that both have work are merged by support, not here. Apple always opens
  the account its Apple ID is linked to (`apple_accounts.sub`, unique), whatever its phone column says.
- **Notifications:** the same messages as Telegram (new homework, due soon, the teacher's reminder, graded), sent to
  the iPhone too when the student has the app with notifications on; the same once-only keys, so never twice.

## Card transfers until Payme or Click (BF)

**BF. Selling plans by card transfer in the Telegram bot, while there is no YaTT or MChJ for a merchant account
(2026-10-11).** `server/payments/card.ts`, `server/telegram/shop.ts`.
- **In the bot:** /tarif → Pro or VIP → months → "💳 Karta orqali o'tkazma": the card number (with a copy button), the
  exact amount and an order number → the buyer sends the receipt (photo or PDF) → it's copied to the admins' chat with
  ✅ Tasdiqlash / ❌ Rad etish → approving turns the plan on (the same `markPaid` as Payme and Click: revenue, teacher
  commission, Admin → Money) and the buyer is told; rejecting tells them too. Only the admins' chat can approve.
  A photo with no card order waiting is an ordinary support message.
- **On the website,** while no provider is connected: the plans page shows "Pay by card via Telegram", opening the
  bot on the plan and months chosen (`?start=tarif_<plan>_<months>`); a teacher's package goes to support.
  Never in the iOS or Play apps (nothing is sold there).
- **Back to Payme / Click (kept, not removed):** connect them (`PAYME_*` / `CLICK_*`) and the website's normal
  checkout returns by itself; unset `PAY_CARD_NUMBER` to stop card transfers. The git tag `payments-payme-click`
  marks the code before card transfers. Card payments are `provider = 'card'` in `payments`.
- **Telegram alone is enough:** /start keeps "💳 Tarif sotib olish" under the chat; a shared number with no account
  gets a student account there (named as in Telegram), so a buyer never has to visit the website. Signing in later on
  the website or in the app with Telegram opens that same account.
- **Channel posts with the shop's button:** the owner sends the bot `/post <text>` (or a photo with that caption), sees
  a preview, and taps "Kanalga joylash"; it goes to `TELEGRAM_CHANNEL_ID` with the button. The button opens the bot,
  not the website, so it keeps "no website links in posts".
- **Risks the owner accepted for the MVP:** income to a personal card, which a bank may question; it is still taxable.

## The Lab improves one methodology at a time (BG)

**BG. The Lab is rebuilt: a methodology is chosen, resources improve its one body of knowledge, and Create follows it
(2026-10-17).** Replaces AX/AY's method cards. `packages/ai/src/lab.ts`, `server/lab.ts`, `/admin/lab`.
- **Methodologies:** every exam style in the catalog (IELTS, TOEFL, Cambridge, Multilevel, TOPIK, HSK…), plus the
  owner's own (name, language, levels, a description for the writers). The owner's own appear in teachers' Style
  list, after the exams, once switched on ("Teachers can pick it"); teachers see only the name. The knowledge itself
  is never shown to teachers or students.
- **The Lab chat, per methodology:** the owner gives a resource (photos, PDF up to 100 pages, Word, or pasted text) or
  writes a message. One call (the strongest model) reads it against what the methodology already knows (an exam's
  built-in description and the learned points) and proposes only what is new and useful: add a point, sharpen one,
  remove one shown wrong. The rest of the resource is skipped, and the reply says what was kept and what wasn't.
  The owner can also ask what it knows, or tell it what to change.
- **Nothing is kept until the owner applies it:** each proposal is a checklist; apply all, some, or dismiss. Points
  can be removed by hand; every change is saved with the knowledge before it, and the newest can be undone.
- **Knowledge stays small:** at most 50 points of up to 300 characters, each one rule a writer can act on, in our own
  words: never the resource's sentences, examples or keys, and never its name. When nearly full, the AI merges or
  replaces instead of adding. Uploaded files are deleted once read; the chat keeps their names only.
- **In Create:** when a teacher picks an exam, the planner and the checker get its knowledge, and each part's writer
  gets the general points plus its own skill's; an exam with no knowledge yet works as before. The owner's own
  methodology gives its name, level and description too. Revisions keep the draft's style even if the owner later
  switches it off; a deleted one is simply dropped. Digitize ignores all of it. Uses are counted for the Lab.
- **Load:** one AI call per Lab message; a homework gets at most ~50 short lines more in its prompts.
- **The strongest model, always (2026-10-17):** a methodology is written once and every homework in its style
  depends on it, so the Lab runs on `GEMINI_MODEL_LAB` (unset = GENERATE's model, then REVIEW's), thinking hard, and
  never falls back to a weaker model: when it is busy the owner is told to send again.
- The old method cards were deleted (the owner's call); the planner no longer picks a method per part.

## The Lab learns the real test first, and its brain fills up (BH)

**BH. A methodology's blueprint comes from real past samples; books fill in each task; the brain shows how much is
understood; Create aims at it without being limited by it (2026-10-17).** Builds on BG. `packages/ai/src/lab.ts`,
`server/lab.ts`, `components/admin/LabBrain.tsx`.
- **Real samples first:** the owner sends a whole real past test (one per message, all its files; the chat's "A real
  exam" switch, or "Add a real exam" on the brain). The Lab lists every task type in it: the known ones it had, new
  ones with their format in our own words, the exercise kinds that build them, and whether we can build them (free
  speaking and drawn pictures, maps or charts can't be). Applying the proposal counts the sample, even when it taught
  nothing new; "Don't count it" leaves it out. How many samples had each task is kept, so the most-asked tasks are
  known. After 5 samples the brain shows; the Lab says when the newest sample found no new task types.
- **Books fill each task's five slots:** format, building the items, traps and wrong options, building up to it
  (easier steps and preparation for lower levels), good answers and marking. Points belong to a task and a slot, or
  are general. At most 30 tasks, 10 points per task and 40 general points, up to 600 characters each; an over-long
  point is cut at a sentence end, never mid-word (BG's 300-character cut left half-sentences).
- **The brain:** a brain in profile, a lobe per skill (speaking frontal, writing parietal, reading occipital,
  listening temporal, grammar and vocabulary in the cerebellum), each filling with green to its share of filled slots;
  the overall % counts only tasks we can build (the others are hatched, "can't build"). Tapping a lobe lists its tasks
  with their five dots and what is missing. Tasks can be removed by hand (their points become general); undo covers
  tasks and samples too. The Methodology list shows each one's % once its brain shows.
- **Create is guided, never limited (the owner's rule):** the planner sees the buildable tasks with how often real
  samples ask them and gives a part the task it builds toward, or none (vocabulary, grammar and other preparation
  parts are always welcome). Near the target level parts may use the real format; at lower levels they build up to
  it. That part's writer gets the task's whole pattern; other writers get only their skill's general points. The exam
  prompts no longer force every item into exam format, and the checker never "fixes" a preparation item into one.
  Nothing rejects a part for not being an exam task.
- **Unchanged:** nothing is kept until the owner applies it; files are deleted once read (a sample keeps only its
  file names); our own words only, never a sample's passages, questions or keys.

## Telegram sign-in survives a lost browser (BI)

**BI. The bot helps people who got stuck between the website and Telegram (2026-10-17).** `server/telegram/login.ts`,
`app/api/auth/telegram/link`.
- **A number typed by hand** (only digits, 9–15 of them) goes to login, not to support: the bot says it can't be
  typed (only the button proves it's theirs) and shows «📱 Raqamni yuborish» again, in the login's language. A number
  the admin writes in the support admin chat is still an answer to a user.
- **The "Kirish" button:** once the number is shared, "✅ Tayyor!" comes with a one-time sign-in link
  (`PUBLIC_ORIGIN/api/auth/telegram/link`), for a browser that was lost on the way to Telegram. It works once, for
  ten minutes from sharing the number; whichever signs in first, the browser or the link, uses the login up, and the
  other finds it used ("already used or expired", or straight to the app when that browser is signed in). It keeps
  what the browser asked for (the role, the page to go to), and continues the same way: setting a password, then the
  welcome questions. The owner allowed this website link in the bot (an exception to "no website links yet", which
  still holds for posts and announcements). Inline buttons aren't previewed by Telegram, so nothing opens it early.

## Whole books in the Lab go to Google's file store (BJ)

**BJ. A Lab PDF can be a whole book, up to 100 MB (2026-10-19).** `server/lab-uploads.ts`, `packages/ai/src/llm/gemini-files.ts`.
- The owner trains the Lab once per book, so its limit isn't a teacher's: a PDF in the Lab goes to the **Gemini Files
  API** (Google keeps it at most 48 hours) and the AI reads it by reference, never inside the request (about 20 MB at
  most) and never in our database (which a 100 MB book could fill on Neon's free plan).
- The browser sends it in 3.5 MB parts (Vercel refuses a request over 4.5 MB); the server passes them on in the part
  size Google asks for (usually 8 MB), so at most one Google part waits in `lab_uploads` at a time. A part sent twice
  isn't added twice.
- The book is removed from Google and from `lab_uploads` right after the Lab reads it; the daily job removes any
  left behind (a closed tab, a failed read) after a day. Google reads up to 1,000 pages per PDF; a refused book is
  said plainly ("send it in two halves").
- Photos and Word files keep the old way (15 MB, 100 pages). A whole-book read on the strongest model costs more
  than a chapter (a 300-page book is roughly 150k tokens in) and can take minutes; the send stays within the server's
  5-minute limit, so a very long book may need splitting.

## Group codes, and deadlines as durations (BK)

**BK. Students join with the group code; a deadline is a duration, not a date (2026-10-20).** `server/groups.ts`
(joinGroupByCode), `server/deadline.ts`, `components/DurationPicker.tsx`, `components/DueEditor.tsx`.
- **The group code** (on the group page) now does something: a student types it under «Vazifalarim» → «Guruhga
  qo'shilish» and is in the group, seeing all of its homework, as if they had opened one of its links. Case, spaces
  and dashes don't matter. A wrong code simply gives nothing, however often it's typed (the owner's call: no limit on
  tries). An archived or deleted group's code doesn't work; the teacher's own doesn't enrol the teacher (they see
  their homework as a preview, never as a student in their own ranking).
- **The teacher gives a duration** ("1 kun", "2 kun", "3 kun", "1 hafta", "2 hafta", "1 oy", or any number of days up
  to 180), not a date (the owner's idea). Every student gets all of it **from when the homework reached them**: when
  it was published, or when they joined the group, if later (by the code, or by opening one of its links; homework
  outside their groups: when they opened it). It ends at 23:59 Tashkent on the last day. Not from when they first
  open it: a student could then put a deadline off forever by not opening the homework.
- So a new student is never late for homework given before they came, and a homework given again (to a new student,
  or to another group with "Boshqa guruhga ham berish") never needs a new date. Results' on-time share, ranking ties,
  analytics, the parent's page, "Muddati o'tdi" and the "due tomorrow" reminder all use each student's own deadline.
- **The duration can be changed or removed** after publishing (homework page and results page); results follow, and
  the "due tomorrow" reminder may go once more. `due_at` stays as the deadline of the students who were in the group
  when it was published (display only). Migration 0025 turned existing dates into days (Tashkent days between
  publishing and the date, at least one).
- The results page shows the homework's link and share buttons too (a homework opened from its group lands there).

## Online courses: admin approval, plan-covered or paid (BL)

**BL. A course opens to others only once the admin approves it; it is plan-covered or paid (2026-10-20).** The
owner's decisions: 40% of a course sale stays with 익히미, 60% goes to the teacher; one approval is enough;
students of the teacher's linked classes keep the course free; the lowest price is 50 000 so'm (it was 10 000 until the owner raised it the same day). Replaces "no course
sales" in AZ. `server/courses.ts`, `server/course-plans.ts`, `server/payments/core.ts` (createCoursePayment),
`server/telegram/shop.ts`, Admin → Kurslar.
- **Approval.** A course meant for others (by link or in the catalog) needs the admin once: the teacher presses
  "Tasdiqlashga yuborish" (it needs a lesson), the owner hears it in Telegram, and Admin → Kurslar shows it lesson by
  lesson with every video and homework: **Tasdiqlash** opens it; **Qaytarish** sends it back with a note (the
  teacher hears it in Telegram and the iOS app). Once approved, changes (lessons, price, link or catalog, even
  private and back) need no new approval; the admin can still take a published course down with a note. A private
  course (the teacher's own classes) needs no approval. Courses already open to others when this came were kept
  published; old course prices from before AZ were cleared, so nothing became paid by itself (migration 0026).
- **Plan-covered** (no price): its homework follows each student's own plan, exactly as homework (Free: vocabulary,
  Pro, VIP).
- **Paid** (a price, 50 000 to 20 000 000 so'm): bought once, for life. A buyer does its homework on **VIP**, whatever
  their own plan; anyone else (even with VIP) gets only the **Free items (vocabulary) of every lesson's homework**,
  and the videos and notes of the preview lessons: a taste before buying. One rule decides it everywhere
  (`homeworkPlans`: opening, checking, scoring, pronunciation, the AI tutor, the mistakes review). The homework's own
  class still does it as their homework, on their own plan; students of a class linked to the course, and students
  staff gave the course to, get it in full. A buyer keeps the course if it is later made private, taken down or
  turned plan-covered; a refund takes it back.
- **Course students aren't the teacher's class.** Opening a lesson of a published course no longer adds the student
  to the homework's group (that would also open a paid course through a linked class). The class joins with the
  group code or the teacher's other links.
- **Buying**, until Payme or Click: the course page's "Telegram orqali sotib olish" opens the bot on the course
  (`?start=kurs_<id>`): price → card transfer → receipt → an admin approves in the admins' chat → the course opens and
  the buyer is told. With Payme/Click connected, the course page has the normal checkout. Never in the store apps:
  there, only the free part (no price, no buy button).
- **The teacher's 60%** is recorded on each payment (`commission_krw`, as plan commissions), shown on «Daromadim» with
  the course's name and in Admin → Money; paid out by hand. The terms of use (0.3) say all this.

## Copying from a book: the name, its answer pages, its audio (BM)

**BM. "Kitob mashqlarini nusxalash", the book's answer pages beside the exercise pages, and audio the teacher helps
place (2026-10-20).** The owner's decisions: the mode's name is "Kitob mashqlarini nusxalash" (Russian "Скопировать
упражнения из книги", English "Copy the book's exercises"); the AI never searches a big file or many recordings to
find what it needs, the teacher uploads just that, and only what the teacher doesn't give, the AI works out. Copying
still changes nothing in the exercises (T).
- **The answer pages have their own button** in the composer, "Javoblarni yuklash (ixtiyoriy)": photos, a PDF or a
  Word file, **at most 4 pages** (`CONFIG.maxAnswerPages`), apart from the 12 exercise pages. A longer answer PDF needs
  its pages ("142-143"): the server refuses it with the page count (`answers_pdf_pages`) and the composer asks. Cost:
  a whole Teacher's Book read for every homework was about 1 300–3 000 so'm and slower; 4 pages are about 60–120 so'm.
- **No answer pages:** a warning under the button says the AI will solve the exercises itself and can be wrong; each
  answer it worked out keeps the "Javob AI tomonidan topildi — tekshiring" mark, as before.
- **How the key is used.** The pages go to the model after the materials as "Answer key N", never as a Material (no
  copied exercises, no pictures cut from them). The prompt (`ANSWER_KEY_RULE`, the same in both calls) matches by unit
  or page and exercise number and checks the answers fit the sentences: every unit has an "ex. 4b", so a key for
  another unit doesn't count. Every copied item must say where its answer came from (`answerSource` is required in
  the copy schema; a missing one counts as the AI's own), and it is stored per exercise (`exercises.answer_source`,
  migration 0027). A revision, written without the pages, keeps the source of every item it left unchanged.
- **On the draft**, the "Javoblar" panel: "Kitob javoblaridan: 18 · AI topdi: 4", and the answer pages can be added
  after copying (`server/answer-pages.ts`, purpose `answers` in AI usage): one call reads them and the exercises,
  answers only those the pages clearly cover (never from its own knowledge), replaces their keys and marks, and lists
  where the book's answer differs from the one the exercise had.
- **Answer files aren't kept** (`materials.purpose = 'answers'`): removed as soon as they've been read, and by the
  daily job a day after upload when the copy was never made. The answers are kept as text with the exercises.
- **Audio never replaces a book answer:** the recording then only confirms the track; otherwise its answer is stored
  as from the audio.
- **Audio the teacher helps place.** The panel suggests file names from this homework's own tracks ("Track 1.12.mp3").
  Several files, a folder (computers only: iOS has no folder picker) or the book's ZIP can be picked at once: the
  browser keeps only the tracks whose names match (`@ikhimi/ai/audio-names`, fflate for the ZIP, which unpacks only
  those) and uploads just them; the AI still listens once to each. A file it can't place, the teacher places: a chip
  per track, as before, and now an "Audio yuklash" button on each listening exercise without its recording, which
  sends the file straight to it.
- **"Baribir ulash".** When the AI says a recording doesn't fit, the teacher can attach it anyway (the model can be
  wrong too): no listening call, and an answer the AI only guessed keeps the "check" mark.

## The teachers' help chat (BN)

**BN. A help chat in the corner of every teacher page answers how to use 익히미 (2026-10-21).** The owner's
decisions: all teachers get it (students have the tutor, not this); a small button in a corner; it can send a question
on to the team; Admin shows only the most asked questions. `components/HelpChat.tsx`, `server/help.ts`,
`content/help-guide.ts`, `packages/ai/src/help.ts`, `/api/help`, `/api/help/handoff`.
- **It answers only from the guide** (`content/help-guide.ts`): one topic per feature, written for the model, with every
  on-screen name taken from the message catalogs (`L('compose.mode.digitize')` → «Kitob mashqlarini nusxalash» in the
  teacher's language), numbers from CONFIG and the prices in force. It never invents a feature; what the guide doesn't
  cover it says plainly and offers «Jamoaga yozish». A question that isn't about 익히미 gets one kind sentence, never
  homework. Links come from a fixed list of pages, never as URLs the model writes. **When a feature changes, change its
  topic in the guide in the same commit**, like the legal texts. In the store apps the topics about buying are left out.
- **It knows the page** it was opened on (home, draft, results, group, course…), for "how do I do this here", and the empty
  chat suggests three questions for that page.
- **«Jamoaga yozish»** copies the conversation into the support admin chat (`SUPPORT_ADMIN_CHAT_ID`), through the bot that
  runs support, under a header naming the teacher. A Reply there reaches the teacher's Telegram, as with support
  messages (AG). When the bot can't write to the teacher (no Telegram, or they never started the support bot), the header
  gives their phone number instead, so the team can call, and the teacher is told so.
- **Light, as side features must be.** One small call per question on the `fast` model (purpose `help` in AI usage),
  with the guide as the prompt (about 7k tokens). Limits a day per teacher: `CONFIG.help.questionsPerDay` = 40 and
  `handoffsPerDay` = 3. The conversation is kept in the teacher's browser tab (sessionStorage), never on the server; each
  question stores only its guide topic, or for a question the guide doesn't answer a few normalised words
  (`help_questions`, migration 0028), removed after `CONFIG.help.keepDays` = 90 days and when the account is erased.
- **Admin → O'sish** shows the last 30 days: how many questions, teachers and hand-offs, the 10 most asked topics, and
  the 10 most asked questions the guide doesn't answer, which are the ones to add to the guide.
- The button sits above whatever is docked at the bottom (the apps' tab bar, the draft's publish bar, the composer on a
  phone: `data-bottom-dock`), so it never covers a button. Privacy policy section 4 says what the chat sends and keeps
  (legal version 0.4).
