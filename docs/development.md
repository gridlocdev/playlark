# Development

Playlark is a TypeScript pnpm workspace. One Preact build runs in the browser, inside the Electron app and from the NAS server. [Architecture](architecture.md) explains the layout, and the [product requirements](plans/prd.md) say exactly how everything behaves.

## Getting set up

You need Node 22.18 or later, pnpm (through corepack) and [just](https://github.com/casey/just). Run `just` on its own to list every recipe.

```bash
just setup   # corepack enable, then pnpm install
```

### Running it

| Recipe | What it runs |
| --- | --- |
| `just run-web` | The web client on http://localhost:5173 with hot reload; it opens a folder you pick |
| `just run-server [dir]` | The NAS server on http://localhost:8830, serving the built client and a music folder (the fixtures by default) |
| `just run-web-nas` | The web client with hot reload, its API proxied to `just run-server` |
| `just run-desktop` | The desktop app (builds the web client first) |
| `just run-desktop-headless` | The desktop app with `--headless`: no window, Dock icon, sound or dialog, on `./.headless-data`, playing the fixtures, with DevTools on port 9348 |
| `just cli <args>` | The `playlark` command, from source: `just cli --dir ~/Music check` |
| `just drive <steps>` | The web client in a headless browser, for a quick look: `just drive "cmd:Show Queue" shot:queue` |

The desktop app takes these settings from the environment:

| Variable              | What it does                                           |
| --------------------- | ------------------------------------------------------ |
| `PLAYLARK_MUSIC`      | The music folder, instead of the one chosen in the app |
| `PLAYLARK_USER_DATA`  | The profile folder (settings, window state)            |
| `PLAYLARK_HEADLESS=1` | The same as `--headless`                               |

The server takes `--dir`, `--port`, `--host` and `--no-auth`, or `PLAYLARK_MUSIC`, `PLAYLARK_PORT` (8830), `PLAYLARK_HOST` (127.0.0.1), `PLAYLARK_NO_AUTH`, `PLAYLARK_HOSTS` and `PLAYLARK_STATIC`. It has no accounts: on an address other machines reach it only starts with `--no-auth`, behind a reverse proxy that asks for a login.

## Checking your work

GitHub Actions (`.github/workflows/check.yml`) runs `pnpm check` and the browser scenarios on every push to `main` and every pull request. The desktop scenarios run locally only.

```bash
just check        # everything CI runs: format, lint, typecheck, tests, build
just test         # the tests once (pass a file or -t "name" to narrow them)
just check-arch   # the architecture rules only
just e2e          # browser scenarios against the built web client and the server
just e2e-desktop  # the desktop app, headless, on a throwaway profile
```

`just check` must pass before every commit. The browser scenarios run on port 8831, on a copy of `e2e/fixtures/basic` in `.e2e-data`.

## Audio fixtures

The tests use short generated tones with made-up tags, never real music. `just fixtures` regenerates them with ffmpeg; commit what it writes.

## Packaging

```bash
just package-desktop      # .dmg and .zip on macOS, .exe on Windows, AppImage on Linux, in apps/desktop/release
just package-desktop-dir  # an unpacked app only, faster
just install-desktop      # macOS: package and copy to /Applications; the old copy goes to the Trash. If Playlark is running, it asks to quit it and reopens it after
```

## App icon

`assets/icon.svg` is the source of every icon. After changing it, run `just icons` (needs Inkscape; `icon.icns` needs macOS) and commit what it writes: `apps/desktop/build/icon.{icns,ico,png}` and the web app's icons in `apps/web/public`.

## Docker

`docker build -t playlark .` builds the NAS image: it builds the web client, then runs the server from source with no dependencies outside the workspace. `compose.example.yaml` shows how to run it; see [Running on a NAS](guides/nas.md).
