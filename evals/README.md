# evals

Generation-quality suite (§8.7). Real teacher requests go through the real Create pipeline (plan → parts written in
parallel → solve-back → review), and every homework is checked automatically. Run it before and after a prompt change
and compare.

```bash
pnpm --filter @ikhimi/evals eval                                # all fixtures, 2 at a time
pnpm --filter @ikhimi/evals eval -- --only=en-count,en-kinds
pnpm --filter @ikhimi/evals eval -- --concurrency=1             # gentler on a free-tier key
```

It needs `GEMINI_API_KEY` (read from `apps/web/.env.local` when it isn't set) and makes real AI calls: about 8–12
per fixture, so about 100 for the whole suite. The same `GEMINI_MODEL_*`, `GEMINI_THINKING` and `AI_REVIEW` settings
as the app are used. Details of every run are saved in `evals/results/` (not committed).

## What is checked

Hard checks (a request fails if any fails):

- **language**: the plan and the homework teach the expected language.
- **count / kind**: the teacher's number of items, and kinds, are planned exactly (vocabulary repetition comes on top).
- **written**: every planned item was written.
- **structure**: no item breaks a rule: asks students to speak where they can only type or choose, says "listen" with
  nothing to hear, mentions brackets the sentences don't have.
- **script**: the instructions are written in Korean.
- **vocab / skill**: vocabulary repetition on or off as asked; a part for each skill asked for.

Soft checks (reported as warnings): **time** within ±25% of the minutes asked (only when the teacher didn't fix the
counts), and **solve-back** (a second model solving each item agrees with its answer key). Solve-back agreement over
the whole suite must be at least 95%, or the run fails.

## Adding a fixture

Add an entry to `fixtures/requests.json`: the teacher's words as a teacher would write them, the interface language
(`ko`), the minutes, and what must come out (`expect`). Text-only requests for now; book
photos can be added later as files next to the fixtures.

`pnpm --filter @ikhimi/evals test` checks the checker itself (no AI calls).
