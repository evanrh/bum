# AGENTS.md — how work happens in this repo

This project is driven by the ticket plan in `plans/`. Read
`plans/README.md` **in full** before starting any ticket — it is the
single source of truth for technical decisions, the data model, and the
delegation protocol.

## Git workflow

1. **Every unit of work gets its own branch off `main`.** Name the
   branch after its owning ticket: `feat/t03-auth`, `fix/t04-rating-cascade`,
   `refactor/t05-jobs`, `docs/rotation-model` — keep the ticket number
   (or a clear topic) in the branch name so commits and PRs trace back
   to the plan. Docs count as work: a plan change gets a `docs/…`
   branch, not a direct commit to `main`.
2. **No direct commits to `main`.** `main` only moves via PR merges.
3. **PR when the work is done.** Acceptance criteria checked, and
   `npm test`, `npm run test:coverage`, `npm run typecheck` and
   `npm run build` all green → open a PR to `main` that summarizes what
   shipped plus any ticket *Deviations & notes* updates.
   **The agent opens PRs only — it never merges them.** Once the PR is
   open, the agent's work on that branch is done; merging is the owner's
   review call.
4. **One ticket per branch per agent run** (see "Delegation protocol"
   in `plans/README.md`). Dependent work stacks: branch off the branch
   you depend on and merge the PRs in dependency order.
5. **Commit prefixes match the branch's ticket**: `feat(T02): …`,
   `fix(T06): …`, `docs: …` for plan/README-only changes.

## Conventions quick list

- All rules in `plans/README.md` still apply on every ticket: strict
  TypeScript with `.ts` import extensions, Zod at every boundary,
  framework-agnostic `src/lib`, `src/db`, `src/jobs`, real-SQL tests.
- Never rewrite a completed ticket's requirements — record changes in
  the ticket's *Deviations & notes* and, if it alters locked decisions,
  in `plans/README.md` itself, as part of the branch doing the change.
