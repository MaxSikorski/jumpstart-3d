# Review guide

Use this checklist for our own reviews. It does not install or enable a paid
review service. Review the change against the requester's finished result.

## Severity here

- **HIGH:** breaks a user's design or export; loses or leaks user data; sends
  anything off the machine unasked; breaks the site or single-file build;
  removes or changes "Created by J.Siwek"; or merges upstream code incorrectly.
- **MEDIUM:** wrong behaviour in an edge case, no test proving the requester's
  end result, or a regression risk without a test.
- **LOW:** clarity or naming. Report at most three style nits per review.
- **PRE-EXISTING:** a real bug the change did not introduce. Report it as
  such, so it is not blamed on the change; fix it here only if the change
  touches it, otherwise note it for its own piece of work.

## Do not report

- Built output in `docs/` or `dist/`; review its sources instead.
- Generated `src/chisel.html`, `src/flexigen.html`, or `src/meshstep.html`;
  review `tools/*-source.html` instead.
- Vendored code in `third_party/`, or upstream code unchanged by this PR.
- Anything CI already enforces. Record CI failures under the gates rather
  than duplicating them as review findings.

These skips concern where to report findings, not whether to test both builds.

## Always check

- The PR quotes the requester's answer to "What should it end up as?" and
  names the test, or the concrete verification for a change with no code, that
  proves that result from the user's side. If there is no requester answer
  (for example, a blank issue, a plan item, a dependency update, or a PR with
  no issue), quote the plan item or state the outcome yourself, labelled
  "(not from a requester)".
- Our additions stay separable: use our own modules where possible, otherwise
  short blocks marked `jumpstart-3d:` beside upstream code.
- "Created by J.Siwek" stays in the About dialog. For upstream updates, check
  that the merge preserves the author's changes and our additions.
- The served `docs/` site and `file://.../dist/jumpstart-3d.html` both work.
  Keep the site's service worker and the single file's offline operation.
- No new network request happens without user action. Omit credentials where
  possible; never use URLs returned in a response as link targets.
- Keep code lean: no abstraction until a second real caller exists, no
  comments that restate the code, and handle possible errors where they occur.
- Tests exercise real behaviour and fail when the requested outcome is wrong;
  an empty result, skipped assertion, or merely successful exit is not proof.
- User-facing text is plain English. Prefer Node; run Python only through
  uv (`uv run python ...`, `uvx ...`), never a bare `python3`.
- A bug fix addresses the root cause, not only the symptom the report shows.
- A finding names its class of bug, so every instance gets fixed, not only
  the line flagged.

## Sensitive paths: the maintainer merges

A change that touches any of these waits for the maintainer's explicit go
before it merges, even with every gate green: `.github/workflows/`, the
service worker (`src/sw.js` and its handling in `build.mjs`), the update
check, release and build scripts, the MCP server's tools and permissions
(`mcp/`), and this file. An automated review never counts as that go.

## How a review reads

Start with the number of findings by severity, and say plainly "nothing to
fix" when that is the case. A change that touches network calls, storage,
imported files, the service worker or the update check also gets a
`/security-review` pass. Later rounds review only the new diff and never
repeat a finding already answered; every finding is fixed or answered with a
reason. After about three rounds, rethink the approach instead of patching
again. A finding that keeps recurring is fixed at its source: this file, a
skill, or a test.

## Evidence

Every behaviour claim needs a source `file:line` citation, not just a function
or file name. Explain the trigger and user-visible consequence, and cite the
relevant test or reproduction result. No evidence, no finding. State what
failed, was skipped, or remains unverified; never call unrun checks passed.

## Review tiers

Every pull request gets one independent Claude review (gate 3). Only changes
that could lose a design or send data off the machine get more. The PR's
**Review gates** section names the tier.

- **Standard tier (almost everything):** gates 1, 3 and 4: the outcome check,
  one Claude review, and CI. No Codex review (gate 2) and no verify pass. This
  covers geometry, UI, docs, tests, tooling, workflows, build scripts and
  upstream merges alike; the sensitive-path rule above (the maintainer's go)
  still applies to the paths it lists.
- **Full tier:** a change that touches **storage** (`projects.js`,
  `projstore.js`, `folder.js`, `remote.js`, the backup and restore code,
  or anything else that could lose or corrupt a saved design) or the
  **network** (anything that can send data off the machine: `remote.js`,
  `chat*.js`, the report-a-problem and update-check code, the MCP server's
  connections). It gets every gate: Codex review, Claude review, the verify
  pass and a `/security-review` pass.
- **Behavioural risk overrides the file category:** a change in a standard
  file that alters what a user's stored data or network traffic does is full
  tier. When unsure whether a change reaches storage or the network, use the
  full tier; a PR that mixes both is full tier.

## The flake rule

A flaky test does not block a merge. The merge gate is only the build, the
smoke spec and the golden exports; everything else runs nightly. When a test
flakes anywhere, quarantine it in the same piece of work: skip it
(`test.skip`) or tag it and exclude it, with a comment on the line above that
starts `// quarantined:` and gives an issue link or the reason. Quarantined
tests are on the fix list (`grep -rn "quarantined:" test`, and the nightly
issue lists them); the root cause is the next piece of work and the skip is
removed with the fix. Never quarantine a smoke or golden test to get a merge
through: those two are the gate, so fix them first. See
[test/README.md](test/README.md).

## The gates

1. **Outcome check first.** Contributors record the finished result and write
   the proving test before implementation. Show that it fails for the missing
   or broken behaviour, then passes with the change. Keep its name and result
   in the PR, together with anything it does not cover. For a change with no
   code, the outcome check is a concrete verification recorded as such (for
   example, the YAML parses and the form keeps its fields, or the page
   renders), never a faked test. No change skips gates 1, 3 and 4; the tier
   above decides whether gate 2 and the verify pass apply.
2. **Codex review (full tier only).** The maintainer runs this gate with a
   Codex reviewer (a Codex model). Give the reviewer this file and the PR's
   outcome and diff. Review against this checklist independently of the Claude
   reviewer.
3. **Independent Claude review (every tier).** The maintainer runs this gate
   with a Claude model. On the full tier it runs in parallel with the Codex
   reviewer, and neither sees the other's findings before both finish. Pass
   `REVIEW.md` explicitly in the brief: `/code-review` reads `CLAUDE.md` but
   does not automatically read this file. Both reviewers use the public rules
   above. On the standard tier this is the only review and there is no verify
   pass. On the full tier a separate verify pass checks every serious (HIGH or
   MEDIUM) or disputed finding against the code with `file:line` evidence and
   breaks ties. Only a genuine remaining disagreement on a HIGH finding stops
   for the maintainer. Rank verified findings HIGH/MEDIUM/LOW, remove
   duplicates, fix them as appropriate, and record their disposition.
4. **CI.** The merge gate is the check named `test` (with CodeQL): both
   builds, the smoke spec and the golden exports on each, about 3 minutes.
   The full Playwright suite, the export judge, the chat scorer, the fuzzer and
   the Firefox and WebKit runs happen nightly
   (`.github/workflows/nightly.yml`), not on each PR; a red nightly run opens
   or updates the one "Nightly failures" issue, which is looked at the next
   working day and its cause fixed as the next piece of work. Firefox and
   WebKit do not block anything yet. Run the nightly on a branch with
   `gh workflow run nightly.yml --ref <branch>` when a change needs the wider
   suite first. See [test/README.md](test/README.md) for commands and limits.
   A selected test or local build does not replace CI; record failures and
   skipped checks explicitly.
   One exception: a pull request to `main` that changes only top-level Markdown
   files (README.md, NOTICE.md, CHANGELOG.md and the like) takes CI's docs-only
   lane, which runs the MCP tests (they read README.md) and skips the browser
   gate; any other file, or a pull request into another branch, runs the whole
   gate.
5. **After release.** The maintainer rechecks the quoted outcome on the live
   site after the release reaches it; merging to `main` alone does not release
   the site. The maintainer also opens the released single file from disk and
   checks the outcome. Until then, record this gate as pending, not passed.

Every PR has a **Review gates** section recording gates run, findings with
severity and evidence, fixes, and what was not tested. Keep review results in
that description; do not post review comments under the maintainer's account.

If managed Claude Code Review is enabled later, it reads the merged
default/base-branch copy of this file, not the PR's proposed copy. Merge this
guide before relying on that integration. See the
[customization docs](https://code.claude.com/docs/en/code-review-customize).
