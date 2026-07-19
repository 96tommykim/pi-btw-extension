# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

First public release. Extracted from a private harness repository, where the
feature was developed and hardened through five milestones.

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
