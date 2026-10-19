# Landlord (daily-grind)

A side-on apartment-block management sim for phones: you're the landlord, tenants live their own lives. Vite + TypeScript, canvas plus DOM UI, vitest. The landlord game is at the repo root; the old café game is in `cafe/`.

- `npx vitest run` (tests, including slow soak tests), `npx tsc --noEmit -p .`, `npm run build`.
- The sim is deterministic and seeded: never use `Math.random` in `src/sim`; use `rng.ts`.
- Pushing to `main` deploys to GitHub Pages.
- Design rules live in the "Landlord game bible" and "Landlord game spec" docs; follow their tone (dry, British, plain words).

## Use the right model for each job

When spawning agents (the Agent tool's `model`), pick the model by the job, not by habit:

| Job | Model |
| --- | --- |
| Design, architecture, new systems that touch many files, tricky sim balance, code review, merging parallel work | `opus` |
| Well-specified implementation: a feature with a clear brief, UI work, tests, refactors within a few files | `sonnet` |
| Quick lookups: finding files or symbols, summarising a file, checking a fact, simple mechanical edits | `haiku` |

- Run independent jobs in parallel, each in its own git worktree on its own branch, and merge them back with the full test suite passing.
- The coordinating session reviews and merges; agents don't push to `main` unless told to.
