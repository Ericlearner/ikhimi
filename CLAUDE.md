# 익히미 (Ikhimi)

The Korean version of a homework app first built for Uzbekistan, copied into its own repository on 2026-10-22
(DECISIONS.md, "Korean version"). It is a separate product: its own database, keys, Telegram bot, domain and app IDs.
Never copy code, settings or data to or from the original app, and never point anything here at its services.

- The interface is Korean only (`packages/i18n/messages/ko.json`, polite 해요체). Don't add other interface languages.
- Learners are Korean speakers learning foreign languages; AI prompts stay in English and ask for Korean instructions.
- Days and deadlines are Seoul time; money is integer won (KRW).

## Product rules the owner set (carried over from the original app)

- **The teacher's request comes first.** In Create mode the AI follows the count, kinds, skills, topic and format the
  teacher wrote; pedagogy defaults only fill what they left open (`teacherSetCount` skips time trimming).
- **Copying a book stays a copy.** New exercise types, methodology rules or AI behaviour go to Create mode only; the
  book-copying mode (교재 문제 옮기기) copies word for word. Exception: the book's own pictures are cut out in both.
- **One click, no manual steps.** Never make teachers build or fix exercises by hand (no crop tools, frame dragging,
  picture editors); the AI decides and falls back automatically.
- **Create plan:** the plan card appears in the chat and nothing is written until the teacher presses 만들기; teachers
  never edit the word list; vocabulary repetition is on by default; exact counts, loose time; choices remembered per
  course. Never AI-generated images: pictures only come from the teacher's materials.
- **Voices are never stored.** The microphone is used only in shadowing and read-aloud; the clip is checked and
  dropped. Text-to-speech says only the word or sentence, never the instructions.
- **Heard items:** keep shadowing with per-sentence scores, dictation, word-stress and minimal pairs. Never a voice over
  a written grammar question, never a prompt mentioning brackets or text the item doesn't show, never "repeat aloud" in
  a typed item; a correct choice is never red.
- **Design for the paid AI.** Don't size quality to free-tier quotas; prefer extra review and grading passes. Still
  flag cost and latency (Vercel's 300 s function limit).
- **Side features stay light.** Background or "learning" features get a cheap check first, caps, and store only what
  is new; teachers' homework speed comes first.
- **The teacher supplies the pages.** For big sources (answer sections, CDs) the teacher uploads just the needed part
  under small limits; the AI never searches a whole book or listens to every track.
- **The Lab is owner-only** (`/admin/lab`, in English): one knowledge base per methodology, changes applied only by
  the owner; only the owner's own methodology names ever reach teachers.
- **Exam patterns guide, never limit.** Exam knowledge aims homework at the exam's tasks, scaled to level; prep
  exercises outside the exam format stay allowed.
- Learning from teachers' edits was discussed and shelved: don't build it unless the owner asks.
