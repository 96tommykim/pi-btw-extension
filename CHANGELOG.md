# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-19

### Changed

- The input line is now pi-tui's `Editor` — the same multi-line editor as pi's
  main input: Enter submits, `\`+Enter (or Shift+Enter where the terminal
  supports it) inserts a newline, and paste/undo work. Arrow keys move between
  cards or scroll only while the input is empty; with text they belong to the
  editor.
- The overlay frame's title now carries the thread position (`btw · ‹ 2/3 ›`),
  replacing the inner header row.
- The busy spinner is pi-tui's `Loader`, matching pi core's accent-spinner /
  muted-message convention.
- The footer follows pi core's key-hint convention (dim key + muted
  description, `^p`-style short keys) and truncates with an ellipsis instead
  of cutting off mid-word.
- The overlay renders without a background fill, so it blends with any theme;
  the editor's rules use the `border` token and a blank line separates card
  content from the input area.
- Cards use a `❯ question` line and a lowercase `btw` label instead of
  `YOU`/`BTW` blocks; `✓ shared to main` is colored as success.

### Removed

- The thread list (`Ctrl+L`), new-thread (`Ctrl+N`), and thread-delete UI.
  The overlay always continues the active thread; stored threads and session
  replay are unaffected.

## [0.3.0] - 2026-08-18

### Changed

- The thread overlay is now a pager instead of a scrollback: one Q/A card fills
  the screen at a time, and `←`/`→` step between questions (`PgUp`/`PgDn`
  always do, `←`/`→` do only when the input is empty). `↑`/`↓` scroll within a
  card that is longer than the viewport, top-anchored so the question is
  always visible when you land on it.
- Asking now shows a spinner on a pending card for the question in flight, so
  you can keep browsing earlier questions with `←`/`→` while it answers. The
  pending card belongs to its thread: switching threads hides it, switching
  back shows it again.
- The title row (thread position, and the refine spinner while one runs) stays
  pinned while a long card scrolls.

## [0.2.2] - 2026-08-14

### Changed

- Thread exchanges now use compact stacked `YOU`/`BTW` blocks with indented
  question and answer content, plus a muted separator between exchanges.

### Fixed

- Use pi-tui's single `> ` thread input prompt.

## [0.2.1] - 2026-07-23

### Fixed

- Keep the thread input and shortcut footer visible after long scrollback.

## [0.2.0] - 2026-07-20

### Added

- Delete a thread from the thread list. Press `x` on the highlighted thread and
  `x` again to confirm; any other key cancels. Deleting a thread keeps you in the
  list; if it was the thread you had open, there is nothing to return to, so Esc
  then closes the overlay and the next `/btw` reopens on your most recent
  remaining thread.

## [0.1.2] - 2026-07-20

### Changed

- The package entry point moved to `index.ts` at the package root, and the
  modules behind it moved from `extensions/btw/` to `lib/`. pi builds the
  startup extension label from the entry file's name and shows the package name
  alone only when that name is `index`, so the old layout listed this package as
  `pi-btw-extension:btw.ts` while every other package showed its bare name. It
  now reads `pi-btw-extension`. Nothing about how the extension is installed or
  used changes. Consumers import the package, not its internal paths.
- The thread store is now written owner-only: store files with mode `0600`, and
  mode `0700` for any directory btw has to create on the way to
  `~/.pi/agent/btw/`. The store holds conversation text, so a umask that left it
  group and world readable was wrong. Directories that already exist keep
  whatever mode they have; only the files inside them are tightened, which is
  where the content actually is.

### Added

- A GitHub Actions workflow that runs `npm run typecheck` and `npm test` on
  every push and pull request.

## [0.1.1] - 2026-07-20

### Changed

- The promoted note header is now `[/btw note: ...]` instead of
  `[/btw note - ...]`. The `[/btw note` prefix that the main agent keys on is
  unchanged, so an `AGENTS.md` rule matching it still works.
- Overlay footers separate their key hints with `|` instead of a middle dot.
- README reorganised: flat section names, thread storage folded into How it
  works, removing and updating folded into Install.

## [0.1.0] - 2026-07-19

First public release. Adds multi-threaded side questions grounded in the live
session, persistent per-project thread storage, and promote-to-main sharing.

### Added

- `/btw <question>`: a side question answered against the live session
  context, written to a side thread instead of the main conversation.
- Cache-warm shadow pass: the side question reuses the main session's exact
  system prompt and message prefix, so the provider's prompt cache stays warm.
- Live grounding: every ask re-reads the current main context rather than a
  snapshot taken when the thread opened.
- Automatic depth: the side agent answers from context when it can and reaches
  for a read-only tool allowlist (`read`, `grep`, `find`, `ls`) only when that
  is insufficient, bounded by a tool-call budget.
- Threads with a Quake-style overlay, navigable history, and a per-project
  store under `~/.pi/agent/btw/` that survives restarts.
- Promote to main (`Ctrl+P`): share one answer, a whole thread, or a refined
  summary, as a single self-describing user message. Nothing else ever reaches
  the main conversation.
- Configuration through `BTW_*` environment variables and
  `~/.pi/agent/btw.json`.
