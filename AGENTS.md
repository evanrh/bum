# AGENTS.md — how work happens in this repo

Work is tracked as **GitHub issues** — one issue is one unit of work:
its own branch, commits, and PR, with acceptance criteria as issue
checkboxes. `plans/README.md` is the technical record — locked
decisions, the canonical data model, and conventions — **read the
sections relevant to what you are changing**; they bind every change.

(The markdown ticket files that used to live in `plans/` are retired as
of 2026-11-21, issue #31; T01–T09 remain there as history.)

## Git workflow

1. **Every unit of work gets its own branch off `main`.** Name the
   branch after its owning issue: `feat/31-opengraph`,
   `fix/27-covers-self-heal`, `docs/rotation-model` — keep the issue
   number (or a clear topic) in the branch name so commits and PRs
   trace back to the issue. Docs count as work: a docs change gets a
   `docs/…` branch, not a direct commit to `main`.
   **Do the work in a dedicated worktree** (`git worktree add …`), never
   in the owner's checkout — the owner's checkout stays on `main`, its
   own in-flight edits untouched. Work in the owner's checkout only when
   the owner explicitly asks; leave parallel WIP there alone (stage your
   own files by explicit path, never `git add -A`/`git add .`).
2. **No direct commits to `main`.** `main` only moves via PR merges.
3. **PR when the work is done.** Acceptance criteria ticked on the
   issue, and `npm test`, `npm run test:coverage`, `npm run typecheck`
   and `npm run build` all green → open a PR to `main` that summarizes
   what shipped (linking it with `Closes #N` so the issue closes on
   merge) plus any discovered edge cases worth recording.
   **The agent opens PRs only — it never merges them.** Once the PR is
   open, the agent's work on that branch is done; merging is the owner's
   review call.
   **Merge style — fast-forward only (owner-approved):** once the owner
   approves, the agent may execute the merge mechanically: rebase the
   branch onto an up-to-date `main` first if it has diverged (force-push
   the branch; the PR tracks it automatically), then
   `git checkout main && git merge --ff-only <branch> && git push`.
   `main` therefore stays linear — no merge-bubble commits — and merged
   branches are deleted.
   **Version bump — automated:** the release pipeline bumps and tags on
   every merge to `main` (commit-scan SemVer: any `feat`-prefixed commit
   since the last `v*` tag ⇒ **minor**, everything else ⇒ **patch** — the
   rule lives in `scripts/next-version.mjs`). PRs must NOT carry version
   bumps. The owner's override lever is hand-pushing a `vX.Y.Z` tag
   (hotfixes included). A smoke failure leaves the bump commit and tag on
   `main` (a dangling release) until rerun-failed-jobs completes the
   publish.
4. **One issue per branch per agent run.** Dependent work stacks:
   branch off the branch you depend on and open the dependency PRs
   first — the owner merges them **in dependency order** before the
   dependent PR's review.
5. **Commit prefixes match the branch's issue**: `feat(#31): …`,
   `fix(#27): …`, `docs: …` for docs-only changes.

## Conventions quick list

- All rules in `plans/README.md` still apply on every issue: strict
  TypeScript with `.ts` import extensions, Zod at every boundary,
  framework-agnostic `src/lib`, `src/db`, `src/jobs`, real-SQL tests.
- Comments explain *why*, not *what*: the code stands on its own — no
  narration or restating. Write a comment only when a constraint,
  trade-off, or workaround genuinely needs recording (that's rare);
  an issue reference makes the cheapest version of one.
- Never rewrite a closed issue's requirements — discoveries go in a
  comment or a new issue; if they alter a locked technical decision,
  update `plans/README.md` itself, as part of the branch doing the
  change.
