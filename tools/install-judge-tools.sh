#!/usr/bin/env bash
set -eu
set -o pipefail

[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || { echo 'The pinned judge consumers require Linux x86_64.' >&2; exit 1; }
repo=$(cd "$(dirname "$0")/.." && pwd)
cache=${JUDGE_TOOL_CACHE:-"$HOME/.cache/js3d-judge"}
install=${RUNNER_TEMP:-"$repo/test-results"}/js3d-judge-tools
logs="$repo/test-results/judge/install"
mkdir -p "$cache" "$install" "$logs"
exec > >(tee "$logs/install.log") 2>&1
started=$(date +%s)

# These archives are pinned to the successful October 21, 2026 runner probe.
prusa_url='https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1%2Blinux-x64-newer-distros-GTK3-202409181416.AppImage'
prusa_sha='565f2f4bd4dbb05904a459d54db1916b6932124709c1d17b5aacfe9f5f2f1b03'
freecad_url='https://github.com/FreeCAD/FreeCAD/releases/download/1.1.4/FreeCAD_1.1.4-Linux-x86_64-py311.AppImage'
freecad_sha='f6dc6ba676e5ac96a565ebc8d657232f94c6158e85b4352141bd1a46f6b43434'

prepare() {
  name=$1 url=$2 digest=$3
  archive="$cache/$name.AppImage"
  began=$(date +%s)
  if [ ! -f "$archive" ]; then
    curl -fL --retry 2 --max-time 300 "$url" -o "$archive.part"
    printf '%s  %s\n' "$digest" "$archive.part" | sha256sum --check --strict
    mv "$archive.part" "$archive"
  fi
  printf '%s  %s\n' "$digest" "$archive" | sha256sum --check --strict
  chmod +x "$archive"
  rm -rf "$install/$name"
  mkdir -p "$install/$name"
  (cd "$install/$name" && "$archive" --appimage-extract > "$logs/$name-extract.log")
  printf 'TIMING %s download_verify_extract seconds=%s\n' "$name" "$(( $(date +%s) - began ))"
}

apt_started=$(date +%s)
sudo apt-get update
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libwebkit2gtk-4.1-0 libglu1-mesa xvfb xauth
dpkg-query -W libwebkit2gtk-4.1-0 libglu1-mesa xvfb xauth
printf 'TIMING apt_prerequisites seconds=%s\n' "$(( $(date +%s) - apt_started ))"
prepare PrusaSlicer-2.8.1 "$prusa_url" "$prusa_sha"
prepare FreeCAD-1.1.4 "$freecad_url" "$freecad_sha"

printf '#!/usr/bin/env bash\nexec %q "$@"\n' "$install/PrusaSlicer-2.8.1/squashfs-root/AppRun" > "$install/prusa-slicer"
printf '#!/usr/bin/env bash\nexec env QT_QPA_PLATFORM=offscreen %q --console "$@"\n' "$install/FreeCAD-1.1.4/squashfs-root/AppRun" > "$install/freecadcmd"
chmod +x "$install/prusa-slicer" "$install/freecadcmd"
cat > "$install/version.py" <<'PY'
import FreeCAD as App
print('JUDGE_TOOL_VERSION ' + '.'.join(App.Version()[:3]), flush=True)
PY
# The AppImage's GUI version flags crash headlessly; use its console Python host.
timeout 60 "$install/freecadcmd" "$install/version.py" </dev/null > "$logs/freecad-version.stdout" 2> "$logs/freecad-version.stderr"
timeout 60 "$install/prusa-slicer" --help > "$logs/prusa-version.stdout" 2> "$logs/prusa-version.stderr"
node --input-type=module - "$logs" <<'JS'
import { readFileSync } from 'node:fs';
const dir = process.argv[2];
const freecad = readFileSync(`${dir}/freecad-version.stdout`, 'utf8');
const prusa = readFileSync(`${dir}/prusa-version.stdout`, 'utf8');
if (!freecad.split(/\r?\n/).includes('JUDGE_TOOL_VERSION 1.1.4')) throw new Error('FreeCAD version smoke failed');
if (!prusa.startsWith('PrusaSlicer-2.8.1+linux-x64-GTK3-202409181416 based on Slic3r')) throw new Error('PrusaSlicer version smoke failed');
console.log(freecad, prusa.split('\n')[0]);
JS
if [ -n "${GITHUB_ENV:-}" ]; then
  printf 'PRUSA_SLICER=%s\nFREECAD_CMD=%s\n' "$install/prusa-slicer" "$install/freecadcmd" >> "$GITHUB_ENV"
fi
printf 'PRUSA_SLICER=%s\nFREECAD_CMD=%s\n' "$install/prusa-slicer" "$install/freecadcmd"
printf 'TIMING install_total seconds=%s\n' "$(( $(date +%s) - started ))"
