#!/bin/bash
# Sabr SI — Download & Install (hardened)
# Usage: curl -sL http://2.25.174.126:8500/landing-assets/bootstrap.sh | bash
#
# Does ALL non-interactive work: download brain, extract, install system deps,
# create venv, install python deps, VERIFY imports. Then hands off to ./setup.sh.
#
# NOTE: intentionally NO `set -e`. We handle errors explicitly and report the
# REAL reason on failure instead of dying silently mid-pipe.

G='\033[38;5;39m'; C='\033[38;5;45m'; Y='\033[0;33m'; R='\033[0;31m'; P='\033[38;5;213m'; N='\033[0m'
say(){ echo -e "$@"; }
die(){ spin_stop 2>/dev/null; say "${R}[FAILED]${N} $1"; [ -n "$2" ] && { say "${Y}--- details ---${N}"; echo "$2" | tail -12; }; exit 1; }

# Pink bouncing progress bar that runs while a slow step works
TTY=0; [ -t 1 ] && TTY=1
SPIN_PID=""
spin_start(){
  [ "$TTY" != 1 ] && { say "$1"; return; }
  ( w=24; pos=0; dir=1
    while :; do
      bar=""
      for ((i=0;i<w;i++)); do [ $i -eq $pos ] && bar="${bar}█" || bar="${bar}·"; done
      printf "\r   ${P}[%b]${N} %s" "$bar" "$1"
      pos=$((pos+dir)); [ $pos -ge $((w-1)) ] && dir=-1; [ $pos -le 0 ] && dir=1
      sleep 0.05
    done ) & SPIN_PID=$!
}
spin_stop(){
  [ -n "$SPIN_PID" ] && { kill "$SPIN_PID" 2>/dev/null; wait "$SPIN_PID" 2>/dev/null; }
  SPIN_PID=""; [ "$TTY" = 1 ] && printf "\r\033[K"
}

# ── Branded intro (animated only on a real terminal) ──
TTY=0; [ -t 1 ] && TTY=1
banner(){
  local logo=(
"   ███████╗ █████╗ ██████╗ ██████╗ "
"   ██╔════╝██╔══██╗██╔══██╗██╔══██╗"
"   ███████╗███████║██████╔╝██████╔╝"
"   ╚════██║██╔══██║██╔══██╗██╔══██╗"
"   ███████║██║  ██║██████╔╝██║  ██║"
"   ╚══════╝╚═╝  ╚═╝╚═════╝ ╚═╝  ╚═╝"
  )
  echo ""
  for line in "${logo[@]}"; do
    say "${C}${line}${N}"; [ "$TTY" = 1 ] && sleep 0.06
  done
  echo ""
  local tag="   S Y N T H E T I C   I N T E L L I G E N C E   P L A T F O R M"
  if [ "$TTY" = 1 ]; then
    printf "\033[2m"
    for ((i=0;i<${#tag};i++)); do printf "%s" "${tag:$i:1}"; sleep 0.012; done
    printf "\033[0m\n"
  else
    say "\033[2m${tag}\033[0m"
  fi
  say "\033[2m   a Sabr company · 47 Industries\033[0m"
  echo ""
}
banner

OS="$(uname)"
ARCH="$(uname -m)"

# ── Release pin ────────────────────────────────────────────────
# The digest of the release this script installs, pinned HERE and nowhere
# else. This script reaches the customer over HTTPS with its own HTTPS
# sidecar, so it is the trust anchor; a digest fetched from beside the
# tarball would only prove the payload arrived intact from whoever sent
# it, which is not the same as proving we sent it. Written by
# build_release.sh — never edit by hand, and never fetch it at runtime.
EXPECTED_RELEASE_SHA256="1d515d7d1d6feae3f7000f96fbb14d02075e429721f76396a9316c8205257ef6"

# -- macOS bootstrap (runs FIRST, before we need Python) --
# A fresh Mac has no compiler, no Homebrew, and often no real python3. This
# block is self-healing and arch-aware: it detects Apple Silicon vs Intel on
# its own (uname -m), so the user never has to know or say which chip it is.
brew_prefix(){
  if [ "$ARCH" = "arm64" ]; then echo "/opt/homebrew"; else echo "/usr/local"; fi
}
ensure_brew_on_path(){
  local bp; bp="$(brew_prefix)"
  [ -x "$bp/bin/brew" ] && eval "$("$bp/bin/brew" shellenv)" 2>/dev/null
  command -v brew &>/dev/null
}
if [ "$OS" = "Darwin" ]; then
  MACH_TYPE="Intel"
  [ "$ARCH" = "arm64" ] && MACH_TYPE="Apple Silicon (arm64)" || MACH_TYPE="Intel (x86_64)"
  say "${C}Detected macOS on $MACH_TYPE -- configuring automatically.${N}"

  # Check for terminal access EARLY. macOS interactive steps need a real terminal.
  if ! [ -e /dev/tty ] || ! ( : </dev/tty ) 2>/dev/null; then
    die "No interactive terminal available." \
        "This installer must run in a real Terminal window on your Mac (not piped). Run:
    curl -sL https://sabr-technologies-production.up.railway.app/landing-assets/bootstrap.sh | bash
directly in Terminal.app, not through a proxy or script runner."
  fi

  # 1) Xcode Command Line Tools -- trigger install then WAIT (no re-run).
  if ! xcode-select -p &>/dev/null; then
    say "Installing Xcode Command Line Tools..."
    say "${Y}A popup will appear on your Mac. Click Install, then wait for it to finish.${N}"
    say "${Y}This can take several minutes.${N}"
    xcode-select --install </dev/tty >/dev/null 2>&1 || true
    spin_start "Waiting for Xcode tools to finish installing..."
    for i in $(seq 1 240); do
      xcode-select -p &>/dev/null && break
      sleep 5
    done
    spin_stop
    if ! xcode-select -p &>/dev/null; then
      die "Xcode Command Line Tools did not finish installing (timeout after 20 minutes)." \
          "Either: the install was cancelled, or your Mac is very slow.
Try again: xcode-select --install
Click Install when prompted, wait for it to finish, then re-run this installer."
    fi
  fi
  say "${G}[OK]${N} Xcode Command Line Tools"

  # 2) Homebrew -- auto-install if missing, load onto PATH for THIS shell.
  #    Homebrew's installer needs working sudo. Piped through curl|bash it runs
  #    non-interactively and will NOT prompt, so it dies with "Need sudo access".
  #    Fix: prime the sudo credential ONCE against the real terminal, keep it
  #    warm, then let the installer run unattended.
  if ! ensure_brew_on_path; then
    say ""
    say "${Y}Homebrew needs your Mac login password once.${N}"
    say "${Y}Type it at the prompt below (it stays hidden as you type) and press Return.${N}"
    if ! sudo -v </dev/tty >/dev/null 2>&1; then
      die "Could not get admin (sudo) access." \
          "This Mac user must be an Administrator. Log in as an admin user, or in System Settings > Users & Groups make this account an Administrator, then re-run the installer."
    fi
    # keep the sudo timestamp fresh while Homebrew installs.
    # BOUNDED: 60 iterations x 45s = 45 min hard ceiling, so this can never
    # become an immortal background loop if the install below wedges.
    ( for _k in $(seq 1 60); do sudo -n true 2>/dev/null; sleep 45; done ) &
    SUDO_KEEP=$!

    # Fetch the Homebrew installer to disk FIRST, with real timeouts, so a
    # stalled network fails loudly instead of hanging on a static line forever.
    #   --connect-timeout 20 : bound the handshake
    #   --max-time 300       : bound the whole transfer (script is small; 5 min is generous)
    #   --retry 2            : survive a transient blip without user action
    spin_start "Downloading Homebrew installer..."
    if ! curl -fsSL --connect-timeout 20 --max-time 300 --retry 2 --retry-delay 3 \
         https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh \
         -o /tmp/leon_brew_install.sh 2>/tmp/leon_brew_dl.log; then
      spin_stop
      [ -n "$SUDO_KEEP" ] && { kill "$SUDO_KEEP" 2>/dev/null; SUDO_KEEP=""; }
      die "Could not download the Homebrew installer." \
          "Your internet connection timed out or is blocking raw.githubusercontent.com. Check your connection (or a VPN/firewall) and re-run the installer. $(tail -5 /tmp/leon_brew_dl.log 2>/dev/null)"
    fi
    spin_stop
    [ -s /tmp/leon_brew_install.sh ] || {
      [ -n "$SUDO_KEEP" ] && { kill "$SUDO_KEEP" 2>/dev/null; SUDO_KEEP=""; }
      die "The Homebrew installer downloaded empty." "Re-run the installer; if it keeps happening your network is intercepting the download."
    }

    # Spinner so the customer always sees motion, never a frozen static line.
    spin_start "Installing Homebrew (this can take a few minutes)..."
    NONINTERACTIVE=1 /bin/bash /tmp/leon_brew_install.sh \
      </dev/null >/tmp/leon_brew.log 2>&1
    BREW_RC=$?
    spin_stop
    [ -n "$SUDO_KEEP" ] && { kill "$SUDO_KEEP" 2>/dev/null; SUDO_KEEP=""; }

    if [ $BREW_RC -ne 0 ]; then
      die "Homebrew install failed." "$(tail -20 /tmp/leon_brew.log 2>/dev/null)"
    fi

    # Force brew path setup in THIS shell so we can verify it immediately
    ensure_brew_on_path || die "Homebrew installed but not on PATH." "Expected at $(brew_prefix)/bin/brew"

    # Verify Homebrew actually works
    if ! brew --version >/dev/null 2>&1; then
      die "Homebrew installed but not executable." "Try running: eval \$(/opt/homebrew/bin/brew shellenv) && brew --version"
    fi
  fi
  say "${G}[OK]${N} Homebrew (${ARCH} at $(brew_prefix))"

  # 3) Python 3 -- brew-install if the Mac has none usable.
  if ! command -v python3 &>/dev/null || ! python3 -c 'import sys' &>/dev/null; then
    say "Installing Python 3 via Homebrew..."
    if ! brew install python3 </dev/null >/tmp/leon_pybrew.log 2>&1; then
      die "Homebrew could not install Python 3." "$(tail -20 /tmp/leon_pybrew.log 2>/dev/null)"
    fi
    # Re-add Homebrew to PATH in case Homebrew added new paths
    ensure_brew_on_path
    # Verify Python can actually be used
    if ! command -v python3 &>/dev/null || ! python3 -c 'import sys' &>/dev/null; then
      die "Python 3 installed by Homebrew but not executable." "Try: $(brew_prefix)/bin/python3 --version"
    fi
  fi
fi

# ── Find Python ──
PY=""
for p in python3 python; do command -v "$p" &>/dev/null && { PY="$p"; break; }; done
if [ -z "$PY" ] && [ "$OS" = "Linux" ] && command -v apt-get &>/dev/null; then
  # Same courtesy the Mac path extends via brew: install it, don't assign homework.
  APT_SUDO=""
  [ "$(id -u)" != "0" ] && command -v sudo &>/dev/null && APT_SUDO="sudo"
  say "Python 3 not found — installing it..."
  PY_APT_OPTS="-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30"
  $APT_SUDO apt-get $PY_APT_OPTS update -qq </dev/null 2>/dev/null
  $APT_SUDO env DEBIAN_FRONTEND=noninteractive apt-get $PY_APT_OPTS install -y \
      python3 python3-venv python3-pip </dev/null >/tmp/leon_pyapt.log 2>&1 || true
  command -v python3 &>/dev/null && PY="python3"
fi
[ -z "$PY" ] && die "Python 3 not found (automatic install failed or unavailable)." "  Mac:   brew install python3
  Linux: sudo apt-get install -y python3 python3-venv python3-pip
  Log:   /tmp/leon_pyapt.log"
PYVER=$("$PY" -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")')
say "${G}[OK]${N} Python $PYVER ($PY)"

# ── Disk space preflight ──────────────────────────────────────────────
# The python stack (numpy/scipy/faster-whisper/ctranslate2) needs ~1.5GB.
# On a near-full disk pip dies mid-compile with a cryptic error that looks
# like a code bug. Catch it up front with a clean, honest message instead.
AVAIL_KB=$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2{print $4}')
if [ -n "$AVAIL_KB" ] && [ "$AVAIL_KB" -lt 2000000 ]; then
  die "Not enough free disk space (need ~2GB, have $((AVAIL_KB/1024))MB free in $HOME)." \
      "Free up some space, then re-run this installer."
fi

# ── Minimum Python version — B11 ──────────────────────────────────────
# 3.11, and it is derived, not chosen. Requires-Python read from installed
# dist metadata on a working system:
#     numpy  2.4.6   >=3.11   <- binding
#     scipy  1.17.1  >=3.11   <- binding
#     fastapi, uvicorn, requests, aiohttp, Pillow, dotenv, multipart >=3.10
#     anthropic, pydantic, faster-whisper, mss                       >=3.9
# numpy and scipy set the floor. This check previously enforced 3.9, which
# let an install start on 3.9 or 3.10 and then die deep in a pip build with
# an error that never names the cause — the failure this check exists to
# prevent. The source itself does not need 3.11: no match statements and no
# bare PEP-604 unions outside modules with 'from __future__ import
# annotations'. It is a dependency fact, not a syntax fact.
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info[:2] >= (3,11) else 1)'; then
  die "Python $PYVER is too old — the SI needs Python 3.11 or newer." "  numpy and scipy both require Python >= 3.11. Installing on $PYVER
  fails partway through pip with a build error that does not name the
  real cause, so we stop here instead.

  Mac:     brew install python@3.13
  Windows: https://python.org/downloads/  (tick 'Add python.exe to PATH')
  Linux:   sudo apt-get install -y python3.13 python3.13-venv
  Then re-run this installer."
fi

# ── Privilege helper (root => no sudo; else sudo only if usable) ──
SUDO=""
if [ "$(id -u)" != "0" ]; then
  if command -v sudo &>/dev/null; then SUDO="sudo"; fi
fi

# ── System deps (Debian/Ubuntu/Mint — the 47 OS family) ──
if [ "$OS" = "Linux" ] && command -v apt-get &>/dev/null; then
  say ""
  say "Installing system packages (python3-venv, etc.)..."
  # update FIRST (this is why the 47 OS installer works), then noninteractive install
  # Retries + timeouts: a stalled mirror otherwise hangs this step forever
  # with zero feedback (observed live — a dead route to archive.ubuntu.com
  # froze the installer mid-download with no error).
  APT_OPTS="-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30"
  $SUDO apt-get $APT_OPTS update -qq </dev/null 2>/dev/null
  if $SUDO env DEBIAN_FRONTEND=noninteractive apt-get $APT_OPTS install -y \
        python3-venv python3-full python3-pip xdotool wmctrl tmux \
        portaudio19-dev libsndfile1 ffmpeg </dev/null >/tmp/leon_apt.log 2>&1; then
    say "${G}[OK]${N} System deps"
  else
    say "${Y}[WARN]${N} apt-get could not install venv tooling (no sudo password / offline)."
    say "        If venv creation fails below, run this once then re-run installer:"
    say "          sudo apt-get update && sudo apt-get install -y python3-venv python3-full python3-pip"
  fi
fi

# -- macOS: audio + tmux deps (Xcode/Homebrew/Python handled above) --
if [ "$OS" = "Darwin" ]; then
  ensure_brew_on_path
  BP="$(brew_prefix)"

  if ! find "$BP" /usr/local -name "portaudio.h" 2>/dev/null | grep -q .; then
    if command -v brew &>/dev/null; then
      say "Installing PortAudio (for voice I/O)..."
      if brew install portaudio </dev/null >/tmp/leon_portaudio.log 2>&1; then
        say "${G}[OK]${N} PortAudio"
      else
        say "${Y}[WARN]${N} PortAudio install failed (optional) -- voice will still work with software synthesis."
      fi
    fi
  else
    say "${G}[OK]${N} PortAudio (already present)"
  fi

  if ! command -v tmux &>/dev/null; then
    if command -v brew &>/dev/null; then
      say "Installing tmux (for background sessions)..."
      if brew install tmux </dev/null >/tmp/leon_tmux.log 2>&1; then
        say "${G}[OK]${N} tmux"
      else
        say "${Y}[WARN]${N} tmux install failed (optional) -- use './start.sh' instead of background mode."
      fi
    fi
  else
    say "${G}[OK]${N} tmux (already present)"
  fi

  say ""
  say "${C}macOS setup complete:${N}"
  say "  Architecture: $MACH_TYPE"
  say "  Python: $(python3 --version 2>&1)"
  say "  Homebrew: $(brew --version 2>&1 | head -1)"
  say ""
fi

# ── Download ──
say ""
say "Downloading brain..."
INSTALL_DIR="$HOME/leon-brain"
cd "$HOME" || die "Cannot cd to HOME ($HOME)"
# TLS ONLY. There used to be a third entry here —
# http://2.25.174.126:8500/... — and because the list is tried in order with
# no floor, a network that merely blocked the two TLS hosts would quietly
# downgrade the install to an 80MB mind arriving unencrypted from a bare IP.
# The digest pinned below always made that safe from substitution, but safe
# is not the same as acceptable, and a corporate network that blocks bare-IP
# HTTP outright would have failed the install anyway, at the very last step
# and for a reason no customer could read. So the entry is gone and the loop
# refuses any non-TLS URL: a hard, early, legible failure instead of a
# silent downgrade.
#
# Both remaining mirrors were verified serving the real artifact on
# 2026-08-05, against the local release file:
#   sabrtechnologies.com  80828470 bytes, sha256 fded70ed… — byte-identical
#                         to EXPECTED_RELEASE_SHA256 below
#   railway               gzip, same artifact (the older comment here claimed
#                         Railway 404s for this path; that is no longer true)
DL_URLS=(
  "https://sabrtechnologies.com/landing-assets/leon-brain-release.tar.gz"
  "https://sabr-technologies-production.up.railway.app/landing-assets/leon-brain-release.tar.gz"
)
# A tarball may arrive from any source above; it is trusted only if it
# matches the digest pinned in THIS script. Transport and integrity are two
# separate guarantees and this script now insists on both: TLS says the bytes
# were not read or rewritten in flight, the digest says they are the bytes we
# published. There is deliberately NO degrade path for either — an integrity
# check that can be skipped is not one, and refusing to install is honest
# where installing-while-unable-to-verify is not.
if [ -z "$EXPECTED_RELEASE_SHA256" ]; then
  die "This installer has no release digest pinned, so it cannot verify what it downloads." \
      "That means the installer itself was built wrong or edited. Please re-download it:
    curl -fsSL https://sabrtechnologies.com/landing-assets/bootstrap.sh -o bootstrap.sh
and check with Sabr before running anything."
fi
DL_OK=""
VERIFY_FAILED=""
NON_TLS_SKIPPED=""
for DL_URL in "${DL_URLS[@]}"; do
  # Refused, not demoted to last place. This is the guard that keeps the
  # removed bare-IP entry from creeping back in during a hurried edit: a
  # non-TLS source is never tried, however few sources remain.
  case "$DL_URL" in
    https://*) ;;
    *)
      say "  ${Y}refusing a source that is not HTTPS: ${DL_URL}${N}"
      NON_TLS_SKIPPED="1"
      continue
      ;;
  esac
  for attempt in 1 2 3; do
    # --connect-timeout bounds only the handshake; --max-time bounds the WHOLE
    # transfer, and --speed-limit/--speed-time aborts a connection that is alive
    # but trickling (dead peer, throttled mirror) instead of hanging forever.
    if curl -fsSL --connect-timeout 10 --max-time 900 \
         --speed-limit 1024 --speed-time 60 "$DL_URL" -o leon-brain.tar.gz \
       && [ -f leon-brain.tar.gz ] && [ "$(wc -c < leon-brain.tar.gz)" -ge 1000 ]; then
      GOT="$( (sha256sum leon-brain.tar.gz 2>/dev/null || shasum -a 256 leon-brain.tar.gz 2>/dev/null) | awk '{print $1}')"
      if [ -z "$GOT" ]; then
        rm -f leon-brain.tar.gz
        die "This machine has no sha256 tool, so the download cannot be verified." \
            "Install coreutils (Linux: apt install coreutils) or use a Mac/Linux box with shasum, then re-run."
      fi
      if [ "$GOT" = "$EXPECTED_RELEASE_SHA256" ]; then
        say "${G}[OK]${N} Download verified against the pinned release digest."
        DL_OK="1"; break
      fi
      say "  ${Y}digest mismatch from this source — discarding and trying the next...${N}"
      VERIFY_FAILED="1"
      rm -f leon-brain.tar.gz
      break
    fi
    say "  ${Y}source unreachable, attempt $attempt — retrying...${N}"
    sleep 2
  done
  [ -n "$DL_OK" ] && break
done
if [ -z "$DL_OK" ]; then
  if [ -n "$VERIFY_FAILED" ]; then
    die "The downloaded brain did not match the digest this installer expects, so nothing was installed." \
        "Every source that answered served bytes we could not verify. This is either a
stale mirror or an interfered-with download — either way it will not be run.
Expected: $EXPECTED_RELEASE_SHA256
Please contact dean@sabrtechnologies.com before retrying."
  fi
  if [ -n "$NON_TLS_SKIPPED" ]; then
    die "Download failed: no HTTPS source answered." \
        "One or more sources in this installer are plain HTTP and were refused
rather than used — the brain is not delivered over an unencrypted link.
Tried: ${DL_URLS[*]}
If you are on a network that blocks outbound HTTPS to sabrtechnologies.com,
download the release on another connection, or contact
dean@sabrtechnologies.com."
  fi
  die "Download failed from all sources." "tried: ${DL_URLS[*]}
Both sources are HTTPS and neither answered. Check your connection, or
contact dean@sabrtechnologies.com if this keeps happening."
fi
# ── Stop any previously-installed SI before replacing it ──────────────
# Reinstalling over a still-running brain leaves the old process holding
# port 8000, so the fresh one can't bind and it looks like "nothing happens".
# Kill the old instance + its dashboard tmux session first. Scoped to THIS
# install's venv interpreter so unrelated python processes are never touched.
if [ -d "$INSTALL_DIR" ]; then
  say "Stopping previous SI (if running)..."
  pkill -f "$INSTALL_DIR/.venv/bin/python" 2>/dev/null || true
  tmux kill-session -t leon 2>/dev/null || true
  command -v fuser >/dev/null 2>&1 && fuser -k 8000/tcp 2>/dev/null || true
  sleep 1
fi
# ── B4: VALIDATE THEN SWAP. Never delete-then-hope. ───────────────────
# This used to be `rm -rf leon-brain` followed by `tar xzf`. The delete ran
# AFTER the download but BEFORE extraction, pip, or any verification — so any
# failure past that line left the owner with nothing, and took .env (dashboard
# key, SI name, owner name) and brain_state/ (everything the SI has learned)
# with it. Reinstalling to FIX a problem was the act that destroyed the
# instance, and the second install is exactly when that bites.
#
# Now: extract beside the old one, prove the payload is real, carry the
# identity across, swap, and keep the previous tree until the new one has been
# stood up. Nothing is removed until something better exists.
STAGE_DIR="$HOME/.leon-brain-staging.$$"
BACKUP_DIR=""
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR" || die "Cannot create staging dir ($STAGE_DIR)"
tar xzf leon-brain.tar.gz -C "$STAGE_DIR" || {
  rm -rf "$STAGE_DIR"
  die "Extraction failed (corrupt tarball?) — your existing install is untouched."
}
# The tarball's top level is leon-brain/. Prove it before trusting it.
if [ ! -d "$STAGE_DIR/leon-brain" ] || [ ! -f "$STAGE_DIR/leon-brain/run.py" ]; then
  rm -rf "$STAGE_DIR"
  die "Extracted tree is not a brain (no run.py) — refusing to replace a working install."
fi

if [ -d "$INSTALL_DIR" ]; then
  # Carry identity and memory forward BEFORE the swap. Losing these is losing
  # the instance: .env holds the dashboard key and the SI's name, brain_state/
  # holds everything it remembers.
  for keep in .env brain_state; do
    if [ -e "$INSTALL_DIR/$keep" ]; then
      cp -a "$INSTALL_DIR/$keep" "$STAGE_DIR/leon-brain/" 2>/dev/null \
        && say "  ${G}kept${N} $keep" \
        || say "  ${Y}[WARN]${N} could not carry $keep forward"
    fi
  done
  BACKUP_DIR="$HOME/.leon-brain-previous.$$"
  rm -rf "$BACKUP_DIR"
  mv "$INSTALL_DIR" "$BACKUP_DIR" || {
    rm -rf "$STAGE_DIR"
    die "Could not move the existing install aside — nothing changed."
  }
fi

if ! mv "$STAGE_DIR/leon-brain" "$INSTALL_DIR"; then
  # Swap failed. Put the old one back rather than leaving the user with none.
  [ -n "$BACKUP_DIR" ] && mv "$BACKUP_DIR" "$INSTALL_DIR" 2>/dev/null
  rm -rf "$STAGE_DIR"
  die "Could not install the new tree — the previous install was restored."
fi
rm -rf "$STAGE_DIR"
rm -f leon-brain.tar.gz
if [ -n "$BACKUP_DIR" ]; then
  say "${G}[OK]${N} Previous install kept at $BACKUP_DIR"
  say "     Delete it once the new one is confirmed working."
fi
say "${G}[OK]${N} Installed to ~/leon-brain/"
cd "$INSTALL_DIR" || die "Install dir missing after swap"

# ── Tenant identity ────────────────────────────────────────────
# A buyer's install command carries these as an env prefix:
#   curl -fsSL .../bootstrap.sh | SABR_TENANT_TOKEN=... SABR_LEASE_VERIFY_KEY=... bash
# (a piped bash never sees a ?t= query string — the env prefix is the only
# channel that survives the pipe). The verify key is an Ed25519 PUBLIC key:
# safe in shell history and email by construction. THE LEASE IS NOT AN AUTH
# TOKEN — nothing here authenticates against it; it exists so the SI can
# narrate its own condition offline.
if [ -n "${SABR_TENANT_TOKEN:-}" ]; then
  # Replace, never append: a re-install with a new token must not leave two
  # SABR_TENANT_TOKEN lines whose winner depends on the reader — that coin
  # flip would land during exactly the re-install a confused customer runs
  # when something already went wrong.
  if [ -f .env ]; then
    grep -v -e '^SABR_TENANT_TOKEN=' -e '^SABR_LEASE_VERIFY_KEY=' .env > .env.tmp 2>/dev/null || true
    mv .env.tmp .env
  fi
  {
    echo "SABR_TENANT_TOKEN=${SABR_TENANT_TOKEN}"
    [ -n "${SABR_LEASE_VERIFY_KEY:-}" ] && echo "SABR_LEASE_VERIFY_KEY=${SABR_LEASE_VERIFY_KEY}"
  } >> .env
  chmod 600 .env 2>/dev/null || true
  say "${G}[OK]${N} Install registered to your account."
elif [ "${SABR_PAID_INSTALL:-}" = "1" ]; then
  # A paid command always carries a token; if it's gone, the command was
  # mangled in transit and installing unlinked would give a paying customer
  # a mind that doesn't know it belongs to them. Fatal, with the recovery.
  die "This is a purchased install, but its account token is missing — the
command was probably split or edited when copied. Re-copy the ENTIRE
one-line command from your welcome email (it includes
SABR_TENANT_TOKEN=...). Lost the email? Write dean@sabrtechnologies.com
and it can be re-sent."
else
  say ""
  say "${C}NOTE:${N} no tenant token was provided, so this mind has no link to a"
  say "Sabr account. It will install and run, and it will know this about"
  say "itself. If you PURCHASED an SI, don't use the bare command from the"
  say "website — copy the personal install command from your welcome email"
  say "(it starts with curl and includes SABR_TENANT_TOKEN=...). Lost it?"
  say "Email dean@sabrtechnologies.com and it can be re-sent."
  say ""
fi

# ── Privacy scrub ──────────────────────────────────────────────
# Durable on every install: remove Dean's private notes and internal dev
# docs so a client machine never carries his personal life on disk. The
# brain already refuses to load these for client SIs; this clears the raw
# files too. Runs every install, so it survives any tarball rebuild.
rm -f leon_notes.txt BUILD_PLAN_EMBODIMENT.md NEXT_SESSION.md OWNERSHIP.md brain/owner_facts.py \
      GOTCHAS.md BRAIN_REDESIGN.md 2>/dev/null || true
# One client's deployment scaffold must never ship to another client's box.
rm -rf gio-landscaping 2>/dev/null || true

# ── Create venv (the PEP 668-safe path) ──
say ""
say "Creating environment..."
rm -rf .venv
"$PY" -m venv .venv >/tmp/leon_venv.log 2>&1
VPYTHON=""
if   [ -x .venv/bin/python3 ];        then VPYTHON="$PWD/.venv/bin/python3"
elif [ -x .venv/bin/python  ];        then VPYTHON="$PWD/.venv/bin/python"
elif [ -x .venv/Scripts/python.exe ]; then VPYTHON="$PWD/.venv/Scripts/python.exe"
fi

PIPFLAGS=""
if [ -z "$VPYTHON" ]; then
  # venv genuinely could not be built. Fall back to system python but stay
  # PEP 668-safe so pip does not hard-abort (this is what killed the old script).
  say "${Y}[WARN]${N} venv unavailable — using system Python with --break-system-packages."
  say "        (Cleaner fix: sudo apt-get install -y python3-venv && re-run.)"
  VPYTHON="$PY"
  PIPFLAGS="--break-system-packages --user"
else
  say "${G}[OK]${N} Virtual environment"
fi

# ── Install Python deps (with REAL error handling, no silent death) ──
say ""
spin_start "Installing packages (1-2 minutes)..."
"$VPYTHON" -m pip install $PIPFLAGS --quiet --upgrade pip >/tmp/leon_pip.log 2>&1
# CORE deps — the brain CANNOT think or serve without these. If any fail,
# the install is genuinely unusable, so we die with the real reason.
# B12: EXACT pins. Every version below was resolved with importlib.metadata
# from the interpreter actually running a healthy brain — not PyPI latest,
# not guessed. Unpinned, a breaking release of any one of these silently
# breaks every new install worldwide with no change on our side.
# pyperclip and screeninfo stay unpinned: they are NOT installed on the
# reference system, so there is no observed version to pin, and neither is
# imported anywhere in brain/, server/ or sensory/ (0 hits for `import`).
"$VPYTHON" -m pip install $PIPFLAGS --quiet \
      numpy==2.4.6 scipy==1.17.1 fastapi==0.136.3 "uvicorn[standard]==0.49.0" \
      websockets==10.4 python-multipart==0.0.32 python-dotenv==1.2.2 \
      Pillow==12.2.0 mss==10.2.0 psutil==7.2.2 anthropic==0.105.2 \
      requests==2.34.2 aiohttp==3.14.1 \
      pyperclip screeninfo >>/tmp/leon_pip.log 2>&1
PIP_RC=$?
spin_stop
[ $PIP_RC -ne 0 ] && die "pip install failed." "$(cat /tmp/leon_pip.log)"
# VOICE / AUDIO deps — BEST EFFORT. pyaudio needs portaudio headers and often
# can't compile on a bare box; deepgram/elevenlabs are only used when the client
# adds a key. None are hard-imported by the brain, so a failure here must NEVER
# brick the install — the SI still boots, thinks, and talks via the free voice.
spin_start "Installing voice & audio (optional)..."
"$VPYTHON" -m pip install $PIPFLAGS --quiet \
      pyttsx3 faster-whisper deepgram-sdk elevenlabs \
      sounddevice soundfile pyaudio \
      vosk webrtcvad >>/tmp/leon_pip.log 2>&1 || true
# vosk + webrtcvad power the "always listening" wake-word loop (say "hey <name>").
# Default wake backend is Vosk; its ~40MB model auto-downloads on first use.
# Without these, toggling always-listening throws ModuleNotFoundError: vosk.
spin_stop
if [ "$OS" = "Darwin" ]; then
  # pyobjc-framework-Cocoa gives Foundation + AppKit, which pyttsx3's macOS
  # voice driver (NSSpeechSynthesizer) needs — without it the free fallback
  # voice fails to init and the SI goes silent on Mac. ApplicationServices
  # alone is NOT enough.
  "$VPYTHON" -m pip install $PIPFLAGS --quiet pyobjc-framework-ApplicationServices pyobjc-framework-Cocoa >>/tmp/leon_pip.log 2>&1 || true
fi
say "${G}[OK]${N} Packages installed"

# ── VERIFY: actually import the core deps. No lying that it worked. ──
say ""
say "Verifying install..."
if ! "$VPYTHON" -c "import numpy, scipy, fastapi, anthropic, dotenv, requests" >/tmp/leon_verify.log 2>&1; then
  die "Core imports failed after install — environment is not usable." "$(cat /tmp/leon_verify.log)"
fi
say "${G}[OK]${N} Core dependencies verified"
# Voice is optional — report it honestly but never fail on it.
if "$VPYTHON" -c "import elevenlabs, deepgram" >/dev/null 2>&1; then
  say "${G}[OK]${N} Premium voice stack ready (ElevenLabs + Deepgram)"
else
  say "${Y}[i]${N} Premium voice stack not installed — SI will use the free built-in voice."
fi

# ── Helper scripts (bake in the resolved python path) ──
printf '#!/bin/bash\ncd "$(dirname "$0")"\nexec "%s" install_client.py\n' "$VPYTHON" > setup.sh
chmod +x setup.sh
printf '#!/bin/bash\ncd "$(dirname "$0")"\nexec "%s" run.py "$@"\n' "$VPYTHON" > start.sh
chmod +x start.sh
say "${G}[OK]${N} Helper scripts created"

# ── Hand off to setup — run it RIGHT NOW, zero copy-paste ──────────────
# bootstrap is normally run via `curl ... | bash`, so stdin is the pipe, not
# the keyboard — setup.sh (which asks 4 questions) would get EOF and die.
# We re-exec it bound to /dev/tty so it talks straight to the user's real
# terminal. No "now type this command" step. Only if there's genuinely no
# terminal (CI / headless) do we fall back to printing the one command.
say ""
say "${G}================================================${N}"
say "${G}  Brain installed. Starting setup...${N}"
say "${G}================================================${N}"
say ""
if [ -e /dev/tty ] && ( : </dev/tty ) 2>/dev/null; then
  exec ./setup.sh </dev/tty >/dev/tty 2>&1
else
  say "  No interactive terminal here. Finish setup with:"
  say ""
  say "    ${C}cd ~/leon-brain && ./setup.sh${N}"
  say ""
fi
