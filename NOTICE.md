# Notice

JumpStart 3D was created by **J.Siwek**. His own versions up to 1.93.8 said so
in the About dialog; this community build keeps that line.

The author's own places (the repository and the video date from 19 October
2026):

- The official site: https://sites.google.com/view/jumpstart-3d-creator/home
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

## License

Since version 2.0 (October 2026) the author publishes the full source code
under the MIT License. The official JumpStart 3D site
(https://sites.google.com/view/jumpstart-3d-creator/home) says: "The full
source code is available and open source under the MIT License, so you're
free to use it, study it, change it and share it." His GitHub repository
carries the same MIT text, and in his 2.0 video he says the same: it is open
source under MIT, "do what you want with it".

This repository is a community fork. It tracks his releases and adds its own
work (listed in [README.md](README.md)) under the same license. The
[LICENSE](LICENSE) file carries the author's two copyright lines ("JumpStart
3D contributors" from his source zip, "classyapps2026" from his GitHub
repository) and one for this repository's additions by Max Sikorski and the
community. The single-file build has no LICENSE file beside it, so
`src/index.html` starts with a short license comment that travels with it.

The author's one request, at the end of his 2.0 video: if you download it
and modify it, share it with others. It is a wish, not a license condition,
and this repository does exactly that.

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
- Poppins, Liberation, IBM Plex and Barlow fonts (SIL Open Font License 1.1)

