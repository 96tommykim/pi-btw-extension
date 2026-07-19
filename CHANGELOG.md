# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-19

First public release. Extracted from a private harness repository, where the
feature was developed and hardened through five milestones.

### Added

- `/btw <question>` — a side question answered against the live session
  context, written to a side thread instead of the main conversation.
- Cache-warm shadow pass: the side question reuses the main session's exact
  system prompt and message prefix, so the provider's prompt cache stays warm.
- Live grounding — every ask re-reads the current main context rather than a
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
