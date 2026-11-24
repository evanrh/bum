---
name: Ticket
description: File a GitHub issue for a request in this repo. Runs background research (plans/README.md + code) to pin root cause and affected areas, scores confidence across files-touched / complexity / vagueness, interviews the user when triggered, shows the final draft for approval, then creates the issue with gh. Use when the user asks to file, create, or write a ticket, issue, or bug report.
---

# Ticket — file a GitHub issue

Turn a request into a GitHub issue (split only when clearly
multi-part). Research → score → maybe interview → draft → explicit
approval → file. **Filing is the whole job**: never create the branch,
commit anything, or start implementing. `plans/README.md`'s Workflow
section binds issues too — read it.

## 1. Background research

Establish what the request is really about before any writing:

1. **Read the relevant parts of `plans/README.md`** — the Workflow
   section, plus any locked decision the request touches (rotation
   semantics, auth, data model, conventions). An issue may not quietly
   contradict a locked decision; if it would, see Edge cases.
2. **Explore the code** (grep/glob, or an explore subagent at medium
   thoroughness): current behavior, root cause for bugs, affected areas
   for features/docs. Collect concrete file paths and symbol names —
   they become the issue's evidence. Line numbers churn; cite paths and
   symbols instead.
3. **Check for existing work**:
   `gh issue list --state all --search "<keywords>" --limit 20`. An open
   issue already covering the request → stop and surface it (suggest a
   comment or a reopen, not a duplicate). A closed issue with the same
   request → a new issue that references it (`#N`); closed issues are
   never rewritten.

## 2. Confidence score

Score three criteria, each 1–5 (higher = riskier), and show the user
the table with a one-line justification per criterion:

| Criterion | 1 | 3 | 5 |
|---|---|---|---|
| **Files touched** | one obvious file/module | a couple of layers (lib + a page or island) | cross-cutting or unknown touchpoints (schema + API + UI + jobs) |
| **Complexity** | mechanical, no real logic | normal feature/bugfix; a new endpoint, DB field, or migration | touches a locked decision, the rotation/auth semantics, or the schema's shape |
| **Vagueness** | names exact surfaces and behavior | clear goal, open implementation choices | direction only ("make it better") |

Report the total as `X/15`, then the verdict:

- **Interview** when vagueness ≥ 4 — always, regardless of the other
  scores — or when the total is ≥ 10.
- **Proceed** otherwise. But if research contradicted the request's
  premise (the code doesn't behave like the user assumes), ask before
  drafting anyway.

## 3. Interview (when triggered)

Ask with the `question` tool (plain chat when that tool isn't
available). Target 2–4 questions per round, at most 2 rounds:
interview to pin expected behavior, scope, and constraints — not
trivia. Ask about the cases the research surfaced; don't ask things the
code already answers.

After interviewing, re-score and report the delta in one line. If the
rounds run out with real unknowns still standing, draft anyway and flag
each as `**Unresolved:** …` in Background — the approval gate is where
the user edits those.

## 4. Draft

Read `references/issue-template.md` — it is canonical; fill it, don't
restructure it. Strip the template's guidance comments: what you show
is exactly what gets filed.

- Title: plain, imperative, ≤ ~70 chars, no type prefix and no issue
  number (gh assigns it).
- Summary states the desired behavior, not the implementation. Add
  `Depends on: #N` when the request builds on other work.
- Facts carry file paths and symbol names. Anything the research did
  not verify in code is written as "(hypothesis)".
- Acceptance criteria: `- [ ]` checkboxes, observable and verifiable —
  they get ticked during the implementing branch's PR prep, and the PR
  closes the issue with `Closes #N`. The standard gates (`npm test`,
  `npm run test:coverage`, `npm run typecheck`, `npm run build`) apply
  to every issue via `plans/README.md` — don't restate them; list what
  is extra for this issue (new tests, specific endpoints, …).

## 5. Approval gate (always)

Show the full title and body verbatim and wait for an explicit OK.
Never run `gh issue create` without it. Changes → revise and re-show
the complete draft. Silence is not approval: end your turn and wait.

## 6. File

No labels; the repo is inferred from the checkout's remote. Pass the
body verbatim from the approved draft:

```sh
gh issue create \
  --title '<approved title>' \
  --body-file - <<'GH_ISSUE_BODY_EOF'
<approved body, verbatim>
GH_ISSUE_BODY_EOF
```

Then report the issue URL and number, plus the suggested branch name
per `AGENTS.md` — `fix/<N>-kebab-slug` (bug),
`feat/<N>-kebab-slug` (feature or tooling), `docs/<N>-kebab-slug`
(docs-only) — and stop.

## Edge cases

- **Multi-part request** → propose one issue per unit of work; file
  separately, each with its own research, score, and approval gate.
- **Request contradicts a locked decision** → don't file silently. Tell
  the user what `plans/README.md` locks and only file (with the
  conflict noted in Background) once they confirm the direction.
- **`gh` fails** → show the raw error and fix the cause (auth, network,
  remote); never blind-retry.
