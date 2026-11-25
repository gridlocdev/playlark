# Playlark — run `just` to list recipes.
set shell := ["bash", "-cu"]

app_name := "Playlark"
release := "apps/desktop/release"

default:
    @just --list --unsorted

# ── Run (dev) ─────────────────────────────────────────────────────────────

# Web client dev server (http://localhost:5173).
[group('run')]
run-web:
    pnpm --filter @playlark/web dev

# Desktop app in dev mode (builds the web client first).
[group('run')]
run-desktop: build-desktop
    pnpm --filter @playlark/desktop start

# Desktop app with no window, Dock icon or sound, on a throwaway profile in ./.headless-data, with the fixtures.
[group('run')]
run-desktop-headless dir=(justfile_directory() / ".headless-data"): build-desktop
    mkdir -p "{{ dir }}"
    cd apps/desktop && PLAYLARK_USER_DATA="{{ dir }}" PLAYLARK_MUSIC="{{ justfile_directory() }}/e2e/fixtures/basic" pnpm exec electron out/main.js --headless --remote-debugging-port=9348

# The built web client, as a static site (http://localhost:4173).
[group('run')]
preview-web: build-web
    pnpm --filter @playlark/web preview

# The NAS server on http://localhost:8830, serving the built web client and a music folder. With no folder it
# serves a fresh copy of the fixtures in .nas-data, so tag and playlist saves never touch the fixtures themselves.
[group('run')]
run-server dir="": build-web
    #!/usr/bin/env bash
    set -euo pipefail
    music="{{ dir }}"
    if [ -z "$music" ]; then
        rm -rf .nas-data/Music && mkdir -p .nas-data && cp -R e2e/fixtures/basic .nas-data/Music
        music=.nas-data/Music
    fi
    PLAYLARK_MUSIC="$music" PLAYLARK_DATA=.nas-data/server node apps/server/src/main.ts

# Web client dev server with the API proxied to `just run-server` (run both).
[group('run')]
run-web-nas:
    pnpm --filter @playlark/web dev

# The playlark command on a music folder: just cli --dir ~/Music songs --artist beat (see docs/guides/cli.md).
[group('run')]
cli *args:
    node apps/cli/src/main.ts {{ args }}

# ── Build ─────────────────────────────────────────────────────────────────

# Build everything: the web client and the desktop app.
[group('build')]
build:
    pnpm build

# Build the web client into apps/web/dist.
[group('build')]
build-web:
    pnpm --filter @playlark/web build

# Build the desktop app's main process and copy the web client into apps/desktop/out.
[group('build')]
build-desktop: build-web
    pnpm --filter @playlark/desktop build

# Package the desktop app for this OS into apps/desktop/release (.dmg and .zip on macOS).
[group('build')]
package-desktop: build-web
    pnpm --filter @playlark/desktop package

# Package an unpacked app only (faster; for local testing).
[group('build')]
package-desktop-dir: build-web
    pnpm --filter @playlark/desktop package --dir

# Package and install into /Applications (macOS). The old copy goes to the Trash. If Playlark is running, it
# asks to quit it first and opens it again afterwards.
[group('build')]
[macos]
install-desktop: package-desktop-dir
    #!/usr/bin/env bash
    set -euo pipefail
    target="/Applications/{{ app_name }}.app"
    built=$(ls -d "{{ release }}"/mac*/"{{ app_name }}.app" | head -1)
    # Anchored, so a shell command that merely mentions the path does not count.
    running() { pgrep -f "^$target/Contents/MacOS/" >/dev/null; }
    restart=""
    if running; then
      # Ask in a native dialog; Cancel (or Escape) makes osascript fail, and the install stops.
      if ! osascript >/dev/null 2>&1 <<'APPLESCRIPT'
    display dialog "{{ app_name }} is running. Quit it, install the new version and open it again? The queue comes back on the same song." with title "Install {{ app_name }}" buttons {"Cancel", "Install and Restart"} default button "Install and Restart" cancel button "Cancel" with icon caution
    APPLESCRIPT
      then
        echo "Not installed: {{ app_name }} is still running." >&2
        exit 1
      fi
      # A normal quit, so every window saves before it closes (the same as ⌘Q).
      osascript -e "tell application \"$target\" to quit" >/dev/null
      for _ in $(seq 60); do running || break; sleep 0.5; done
      if running; then
        echo "{{ app_name }} didn't quit (a window may be asking something). Quit it, then run this again." >&2
        exit 1
      fi
      echo "Quit {{ app_name }}."
      restart=1
    fi
    trashed=""
    if [ -d "$target" ]; then
      trashed="$HOME/.Trash/{{ app_name }} $(date '+%Y-%m-%d %H.%M.%S').app"
      mv "$target" "$trashed"
      echo "Moved the old app to the Trash."
    fi
    ditto "$built" "$target"
    lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
    # Only the installed copy should answer "Open With" for the app's file types.
    "$lsregister" -u "$PWD/$built" 2>/dev/null || true
    if [ -n "$trashed" ]; then "$lsregister" -u "$trashed" 2>/dev/null || true; fi
    "$lsregister" -f "$target"
    echo "Installed $target"
    if [ -n "$restart" ]; then
      open "$target"
      echo "Reopened {{ app_name }}."
    fi

# ── Quality ───────────────────────────────────────────────────────────────

# Everything CI checks: format, lint, typecheck, tests, build.
[group('quality')]
check:
    pnpm check

# Run the tests once (pass a file or -t "name" to narrow them).
[group('quality')]
test *args:
    pnpm vitest run {{ args }}

# Run the tests in watch mode.
[group('quality')]
test-watch *args:
    pnpm vitest {{ args }}

# Lint with ESLint.
[group('quality')]
lint:
    pnpm lint

# Typecheck every package.
[group('quality')]
typecheck:
    pnpm typecheck

# Format every file.
[group('quality')]
fmt:
    pnpm format

# Check formatting without changing anything.
[group('quality')]
fmt-check:
    pnpm format:check

# Architecture rules only: layers, entry points, platform APIs, swallowed errors, file size. Part of `check`.
[group('quality')]
check-arch:
    pnpm vitest run test/architecture.test.ts

# Regenerate every icon file from assets/icon.svg (needs Inkscape; icon.icns needs macOS). Commit the output.
icons:
    scripts/make-icons.sh assets/icon.svg apps/desktop/build --work build/icons --web apps/web/public

# Regenerate the audio fixtures in e2e/fixtures and packages/core/test/fixtures (needs ffmpeg).
[group('quality')]
fixtures:
    ./scripts/make-fixtures.sh

# `--project=web` with the `=`: `--project` takes several names, so `just e2e tape` would read "tape" as one.
# Browser scenarios against the built web client.
[group('quality')]
[positional-arguments]
e2e *args: build-web
    pnpm exec playwright test -c e2e/playwright.config.ts --project=web "$@"

# Drive the web client headless for a quick look: just drive "cmd:Show Queue" shot:queue (see e2e/drive.ts).
[group('quality')]
[positional-arguments]
drive *args: build-web
    node e2e/drive.ts "$@"

# Desktop smoke test: the built Electron app, headless, with a throwaway profile.
[group('quality')]
e2e-desktop: build-desktop
    pnpm exec playwright test -c e2e/playwright.config.ts --project=desktop

# ── Housekeeping ──────────────────────────────────────────────────────────

# Install dependencies (pnpm via corepack).
[group('housekeeping')]
setup:
    corepack enable
    pnpm install

# Remove build output.
[group('housekeeping')]
clean:
    rm -rf .e2e-data .e2e-build apps/web/dist apps/desktop/out "{{ release }}" .headless-data .e2e-results .e2e-report .types-e2e .types-test
    find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete

# Remove build output and every node_modules (run `just setup` after).
[group('housekeeping')]
clean-all: clean
    find . -name node_modules -type d -prune -exec rm -rf {} +
