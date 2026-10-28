# Notice

## License in one place

From **build 24** (v2.5.1-community.24) on, this project as a whole, meaning Max
Sikorski's additions and the combined work, is under the **GNU Affero General
Public License v3.0 only** (AGPL-3.0-only). The full text is in
[LICENSE](LICENSE).

It is based on **JumpStart 3D by J.Siwek**, who publishes his code under the
MIT License. His code stays MIT. His license text and copyright lines are kept
in [LICENSES/MIT-jumpstart-3d-jsiwek.txt](LICENSES/MIT-jumpstart-3d-jsiwek.txt),
and his credit stays in the app's About dialog.

Builds up to and including 23 were released under the earlier terms (this
repository's tooling and additions under MIT, and his app code under MIT). Those
copies keep those terms.

The bundled libraries and fonts keep their own licenses (see "Third-party
software" below).

## Credit

JumpStart 3D was created by **J.Siwek**. His own versions up to 1.93.8 said so
in the About dialog; this community build keeps that line.

The author's own places (the repository and the video date from 19 October
2026):

- The official site: https://classyapps.org/ (his first site, which the
  license quote below comes from: https://sites.google.com/view/jumpstart-3d-creator/home)
- His source repository on GitHub: https://github.com/classyapps2026/jumpstart3d
  (the 2.0 app source and the built single file, under the MIT License; the
  bundled libraries are in his source zip and in this repository)
- His video introducing 2.0: https://youtu.be/OmoVmYzoIsk

This community build is maintained by **Max Sikorski** with the jumpstart-3d
community. When the original download disappeared in October 2026 he put the
app back online, then brought in 1.94 and 2.0 as community members found
them, kept it working, added a reproducible build and a test suite, opened
GitHub Discussions, helps moderate r/Jumpstart3D and spreads the word about
the app. Our additions are listed in [README.md](README.md).

## What the author said about his license

Since version 2.0 (October 2026) the author publishes the full source code
under the MIT License. The official JumpStart 3D site
(https://sites.google.com/view/jumpstart-3d-creator/home) says: "The full
source code is available and open source under the MIT License, so you're
free to use it, study it, change it and share it." His GitHub repository
carries the same MIT text, and in his 2.0 video he says the same: it is open
source under MIT, "do what you want with it".

This is why his code stays MIT inside this AGPL project: MIT allows it to be
combined into a work released under the AGPL. The single-file build has no
LICENSE file beside it, so `src/index.html` starts with a short license
comment that travels with it.

## History

Before 2.0 the author had not chosen any license. This fork began with
versions 1.898 to 1.94, after the original download link went offline, and
rested on goodwill: the code stayed the author's and we claimed none of it.
That is now history. The untouched upstream files, including the 1.94 and 2.0
source zips, are on the `upstream-originals` GitHub release.

## Third-party software

The bundled libraries and fonts keep their own licenses, listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), full texts under `LICENSES/`:

- three.js r169 (MIT)
- replicad 1.1.0 and replicad-opencascadejs 1.1.0 (MIT; the OpenCascade
  kernel inside is LGPL 2.1)
- opentype.js 1.3.4 (MIT)
- Flatbush and Flatqueue (ISC)
- Manifold 3.5.4 (Apache-2.0; the mesh-boolean engine for joins and cuts with an imported mesh, in `third_party/manifold-3d/`) and Clipper2 (Boost Software License 1.0), which is compiled into it
- Poppins, Liberation, IBM Plex and Barlow fonts (SIL Open Font License 1.1)
