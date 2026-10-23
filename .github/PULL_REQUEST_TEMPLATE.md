## What this changes

<!-- One or two sentences: what, and why. Link the issue if there is one. -->

## Outcome and proof

<!-- Quote the requester's answer to "What should it end up as?" -->

>

- Proving test and result (written before implementation):
- What was not tested:

## Review gates

<!-- Follow REVIEW.md. Record pending or skipped gates honestly, including the post-release checks. -->

- Gates run and results:
- Findings (HIGH/MEDIUM/LOW, source file:line evidence; duplicates removed):
- Fixes and verification:
- What was not tested or is still pending:

## Checklist

- [ ] Ran `node build.mjs` (`docs/` and `dist/` are not committed: a PR that adds `docs/` fails CI)
- [ ] Tested the website (served `docs/`): box, fillet in Advanced, STL export, the three helpers, no console errors
- [ ] Opened `dist/jumpstart-3d.html` from disk and it works
- [ ] Additions kept separable from the author's code (own module, or a short commented block)
- [ ] "Created by J.Siwek" still in the About dialog
- [ ] If an AI tool helped write this, I have said so above and listed what I tested myself
