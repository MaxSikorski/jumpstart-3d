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

## Evidence

Every behaviour claim needs a source `file:line` citation, not just a function
or file name. Explain the trigger and user-visible consequence, and cite the
relevant test or reproduction result. No evidence, no finding. State what
failed, was skipped, or remains unverified; never call unrun checks passed.

## The gates

1. **Outcome check first.** Contributors record the finished result and write
   the proving test before implementation. Show that it fails for the missing
   or broken behaviour, then passes with the change. Keep its name and result
   in the PR, together with anything it does not cover. For a change with no
   code, the outcome check is a concrete verification recorded as such (for
   example, the YAML parses and the form keeps its fields, or the page
   renders), never a faked test. No change skips gates 2-4.
2. **Codex review.** The maintainer runs this gate with a Codex reviewer (a
   Codex model). Give the reviewer this file and the PR's outcome and diff.
   Review against this checklist independently of the Claude reviewer.
3. **Independent Claude review.** The maintainer runs this gate with a Claude
   model, in parallel with the Codex reviewer and without sharing either
   reviewer's findings before both finish. Pass `REVIEW.md` explicitly in the
   brief: `/code-review` reads `CLAUDE.md` but does not automatically read
   this file. Both reviewers use the public rules above. A separate verify
   pass checks every serious (HIGH or MEDIUM) or disputed finding against the
   code with `file:line` evidence and breaks ties. Only a genuine remaining
   disagreement on a HIGH finding stops for the maintainer. Rank verified
   findings HIGH/MEDIUM/LOW, remove duplicates, fix them as appropriate, and
   record their disposition.
4. **CI.** CI runs the full suite on both builds, including the export judge,
   phone budget, and chat scorer. See [test/README.md](test/README.md) for
   commands and limits. A selected test or local build does not replace CI;
   record failures and skipped checks explicitly.
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
