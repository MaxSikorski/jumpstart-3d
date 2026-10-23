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
# The runner's default Ubuntu mirror sometimes serves a package at a few KB/s (the 25 MB webkit package did not
# finish in 3 minutes, in runs 39847011980 and 39896805061). So the workflow caches the .deb files (keyed on the
# runner image); a hit installs them with no network. A miss fetches under a hard clock and switches to
# archive.ubuntu.com after the first try. The clock sits on apt itself (as root), so a timeout cannot leave an
# orphaned apt holding the dpkg lock.
apt_pkgs='libwebkit2gtk-4.1-0 libglu1-mesa xvfb xauth'
debs=${JUDGE_APT_CACHE:-"$HOME/.cache/js3d-judge-apt"}
apt_try_seconds=${JUDGE_APT_TRY_SECONDS:-150}
apt_ready() { st=$(dpkg-query -W -f='${db:Status-Status}\n' $apt_pkgs 2>/dev/null) || return 1; [ "$(printf '%s\n' "$st" | grep -cx installed)" = 4 ]; }
if apt_ready; then
  echo 'apt prerequisites already installed'
elif [ -f "$debs/COMPLETE" ] && sudo env DEBIAN_FRONTEND=noninteractive dpkg -i "$debs"/*.deb && apt_ready; then
  echo "apt prerequisites installed from the cached .deb files in $debs"
else
  rm -rf "$debs"; mkdir -p "$debs"
  sudo apt-get clean
  fetched=
  for try in 1 2 3; do
    if [ "$try" -ge 2 ]; then
      echo "Switching apt to archive.ubuntu.com (try $try)"
      sudo sed -i 's#mirror+file:/etc/apt/apt-mirrors.txt#http://archive.ubuntu.com/ubuntu/#' /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null || true
    fi
    if sudo timeout -k 10 "$apt_try_seconds" bash -c "apt-get update -o Acquire::Retries=3 -o Acquire::http::Timeout=20 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --download-only -o Acquire::Retries=3 -o Acquire::http::Timeout=20 $apt_pkgs"; then
      fetched=1; break
    fi
    echo "apt try $try did not finish within ${apt_try_seconds}s (slow or stalled mirror)"
  done
  [ -n "$fetched" ] || { echo "FAILED: could not download $apt_pkgs in 3 tries of ${apt_try_seconds}s; the Ubuntu mirror is too slow. Rerun the job." >&2; exit 1; }
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --no-download $apt_pkgs
  cp /var/cache/apt/archives/*.deb "$debs"/
  touch "$debs/COMPLETE"
fi
dpkg-query -W $apt_pkgs
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
