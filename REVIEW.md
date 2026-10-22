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

Scale the gates to the risk of the change. The PR's **Review gates** section
names the tier.

- **Light tier:** a change that is only documentation, only tests, or only
  tooling (for example `tools/`, `test/`, `*.md`), and touches none of the
  sensitive paths above. It gets gates 1 and 4 and one Claude review (gate 3).
  No Codex review (gate 2) and no verify pass. CI is still required.
- **Full tier:** anything that touches `src/` geometry, imports or exports,
  storage, network calls, the service worker or the update check,
  `.github/workflows/`, `mcp/`, release or build scripts, this file, or an
  upstream merge. It gets every gate: Codex review, Claude review and the
  verify pass.
- **When unsure, use the full tier.** A PR that mixes both is full tier.

## The flake rule

A test that fails and then passes on a rerun with no code change is a flake.
Record it in the PR (test name, run link, what the failure said). The very
next piece of work fixes its root cause; the test is never rerun a second time
across PRs to get past it. A test that fails again after one rerun blocks the
merge.

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
   above. On the light tier this is the only review and there is no verify
   pass. On the full tier a separate verify pass checks every serious (HIGH or
   MEDIUM) or disputed finding against the code with `file:line` evidence and
   breaks ties. Only a genuine remaining disagreement on a HIGH finding stops
   for the maintainer. Rank verified findings HIGH/MEDIUM/LOW, remove
   duplicates, fix them as appropriate, and record their disposition.
4. **CI.** CI runs the full suite on both builds, including the export judge
   and phone budget. The chat scorer and the fuzzer run in a nightly workflow
   (`.github/workflows/nightly.yml`), not on each PR; a red nightly run is
   looked at the next working day and its cause fixed as the next piece of
   work. See [test/README.md](test/README.md) for commands and limits. A
   selected test or local build does not replace CI; record failures and
   skipped checks explicitly.
   One exception: a pull request to `main` that changes only top-level Markdown
   files (README.md, NOTICE.md, CHANGELOG.md and the like) takes CI's docs-only
   lane, which runs the MCP tests (they read README.md) and skips the browser
   suites and judges; any other file, or a pull request into another branch,
   runs everything.
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
