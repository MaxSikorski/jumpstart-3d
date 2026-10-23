# Security

JumpStart 3D runs entirely in your browser. There is no server, no
account and no data sent anywhere: your designs stay in your browser's
storage or in files you save yourself. The only network requests the
website makes are for its own files (the fonts are among them). The
downloaded single file makes none.

## What counts as a security problem here

- A project, STL, 3MF or STEP file crafted so that opening it runs code,
  reads other browser data, or does anything beyond showing a model
- A way for a web page to read your saved designs from another site
- A problem in the website build that could serve something other than
  the files in this repository

Crashes, hangs and wrong geometry from odd files are bugs, not security
problems. Report those as a normal issue.

## How to report

Use "Report a vulnerability" on the
[Security tab](https://github.com/MaxSikorski/jumpstart-3d/security),
which opens a private report only the maintainer can see. Say what you
did, what happened, and attach the file if one is involved. You will get
a reply within a few days, and a fix or an explanation as soon as the
problem is understood.

Please do not open a public issue for a security problem until it is
fixed.

## Scope

This covers the website at maxsikorski.github.io/jumpstart-3d and the
single-file releases on the
[releases page](https://github.com/MaxSikorski/jumpstart-3d/releases).
Problems in the libraries the app bundles (three.js, replicad, OpenCascade
and the others listed in THIRD-PARTY-NOTICES.md) should go to those
projects, but a report here is welcome if you are not sure where it
belongs.

## Verify your download

Every file on the
[releases page](https://github.com/MaxSikorski/jumpstart-3d/releases)
shows its SHA-256 digest next to the file name. After downloading, compute
the digest on your computer and compare it. If the two match, you have the
exact file that was published here.

Mac or Linux, in a terminal:

```
shasum -a 256 jumpstart-3d.html
```

Windows, in PowerShell:

```
Get-FileHash jumpstart-3d.html -Algorithm SHA256
```

If someone re-hosts the file elsewhere, the digest is how you tell whether
it is unchanged. The website itself needs no checking: it is served over
HTTPS from the `docs/` folder of this repository's `release` branch, which the
release step builds from `main`.
