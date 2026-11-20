# Playlark: agent guide

Playlark is a TypeScript music player for a folder of MP3, FLAC, M4A, Ogg and WAV files. The same UI runs in the browser, in the NAS server's client and in the Electron app. The spec is [docs/plans/prd.md](docs/plans/prd.md). The code layout is in [docs/architecture.md](docs/architecture.md). The commands are in [docs/development.md](docs/development.md).

## Gates

- `just check` (the same as `pnpm check`) must pass before you commit. It runs:
  - the Prettier check and ESLint;
  - `tsc -b`;
  - Vitest, which includes the architecture rules in `test/architecture.test.ts`;
  - the build.
- When the owner corrects something, turn the correction into a rule in `test/architecture.test.ts` or into a test. Don't write it as a comment or as a line here.
- Never add to `test/architecture-baseline.json`. Fix the violation instead, and lower or delete its entry when you do.
- A comment is never permission. A deliberate exception goes in `test/architecture-exceptions.json` only after the owner agrees. Exceptions include an `eslint-disable` and a `@ts-expect-error`.
- When you change behaviour, add or update a test in the package's `test/` folder. Also update the PRD section that the code cites (`PRD §n`).
- Some things only show in the running app, such as playback, focus, layout and serving songs through the server. Give each one a scenario in `e2e/`, under its `docs/features.md` heading. Scenarios use the generated fixtures in `e2e/fixtures` only, never a real music library. Run `just e2e` after you change the UI, and `just e2e-desktop` after you change the desktop app.
- Check UI changes headlessly. Use one of these:
  - a background browser (`just drive`);
  - the desktop app with `--headless` or `PLAYLARK_HEADLESS=1`. It has no window, no Dock icon and no sound, and it uses a throwaway profile. It records each dialog it skips in `globalThis.playlarkHeadless`.
- Never open a visible window to check your work. Stop every Electron process that a check starts.

## Layout

| Path | What it is |
| --- | --- |
| `packages/core` | The engine: tag and stream readers for every format, songs, sorting, library scans and the play queue. No DOM or Node (ESLint enforces this). |
| `packages/node-files` | Music folders on Node, shared by the desktop app and the server: listings confined to the folder, media replies with Range support, atomic writes. |
| `packages/ui` | Preact and signals: the command catalog, the player and its Web Audio engine, library sources, settings and shared components. |
| `apps/web` | The Vite entry point and the app's screens. One static build serves the browser, the NAS server and the desktop app. |
| `apps/server` | The NAS server (`node:http`, GET and HEAD only). It serves the client and `/api/{info,files,media}` for one music folder. |
| `apps/desktop` | The Electron shell: the main process, the sandboxed preload bridge, the native menu, and `app://playlark/media/`. |

## Golden rules

1. **The engine stays pure.** `packages/core` knows nothing about the DOM, Node, Preact or styling.
2. **The files are the source of truth.** Playlark reads the music folder. It never changes a song file.
3. **One command catalog.** Keys, ⌘K, context menus, the Electron menu bar and the Keyboard Shortcuts window all read it. Don't wire a key or a menu item past it.
4. **The UI reaches songs only through a `LibrarySource`.** It never knows whether the songs are in memory, picked in the browser, on the NAS or on disk.
5. **Confined access.**
   - `fetch` is used only in `packages/ui/src/library/sources.ts`, and always with a timeout.
   - `localStorage` is used only in `packages/ui/src/settings.ts`.
6. **Security.**
   - The Electron renderer is sandboxed with context isolation. Its only native access is the `playlarkNative` bridge.
   - The desktop app and the server confine every path to the music folder, symlinks included.
   - The server checks `Host` on every request. It listens on loopback unless it is started with `--no-auth`.
7. **Dependencies.** The runtime dependencies are Preact and `@preact/signals`. Don't add a third-party package without the owner's approval. Pin versions exactly.
8. **Nothing left to interpretation.** If a behaviour isn't in the PRD, stop and ask. Then record the answer in the PRD.

## TypeScript conventions

- Use strict mode with `noUncheckedIndexedAccess` and `erasableSyntaxOnly`. That means no enums, no parameter properties and no namespaces. Use union types and `const` objects instead.
- Relative imports end in `.ts`. Use `import type` when you import only types.
- Each package's `src/index.ts` names everything it exports, with no `export *`. Tests import through it.

## Git workflow

- Commit on `main`, in small, coherent commits.
- A commit message is one plain imperative sentence about what the user notices, for example "Play the next song without a gap".
- Commit only when `just check` is green and no questions are open.
