# pi-btw-extension

Ask a question mid-task without derailing the conversation.

`/btw` opens a small overlay, answers using everything your [pi](https://github.com/badlogic/pi-mono)
session already knows, and leaves the main conversation untouched. If an answer turns out to
matter, you hand it to the main agent yourself. Nothing crosses over unless you say so.

## Install

```
pi install npm:pi-btw-extension
```

Needs pi and Node 22.19+. pi already bundles everything this depends on, so there is nothing else
to install.

## Try it

Mid-task, ask the thing you did not want in the transcript:

```
/btw what does this error actually mean?
/btw summarize what we have changed so far
/btw where is retryPolicy used?
```

The first two are answered straight from the session context. The third sends the side agent off
to read files. It decides which to do, per question — there is no separate "deep" command to
remember.

## Using it

| Key or command | What it does |
|---|---|
| `/btw <question>` | Ask. Opens the overlay. |
| `/btw` | Reopen the last thread. |
| `Ctrl+Alt+B` | Toggle the overlay. |
| `Ctrl+L` / `Ctrl+N` | Thread list / new thread. |
| `Ctrl+P` | Share an answer with the main agent. |

On macOS `Ctrl+Alt+B` is Ctrl+Option+B. If your terminal does not send Option as Meta — Terminal.app
does not, by default — the shortcut never reaches pi. Use `/btw` instead.

`Ctrl+P` puts a cursor on the answers you have not shared yet:

| Key | What it does |
|---|---|
| `↑` `↓` | Pick one |
| `Enter` | Share it |
| `a` | Share the whole thread |
| `r` | Rewrite it as a short summary, then share that |
| `Esc` | Never mind |

A shared answer arrives as one self-describing `[/btw note …]` message, so the main agent knows
where it came from. It does not start a turn — the note is simply there the next time the agent
speaks.

## Why it stays cheap

The side question reuses the main session's exact prompt prefix and system prompt, so the
provider's cache stays warm: you pay for the question, not for a second context. And because that
prefix is re-read on every main turn, answers reflect what the agent knows *now* — not what it
knew when you opened the thread.

## Configuration

Environment variables win, then `~/.pi/agent/btw.json`, then these defaults:

| Setting | Default | Environment variable | Notes |
|---|---|---|---|
| `deepMaxTokens` | `4096` | `BTW_DEEP_MAX_TOKENS` | Caps every answer |
| `maxTokens` | `1024` | `BTW_MAX_TOKENS` | Caps only the `r` summary |
| `deepToolCallBudget` | `8` | `BTW_DEEP_BUDGET` | Tool calls per ask before it wraps up |
| `deepToolAllowlist` | `["read","grep","find","ls"]` | — | Can only narrow this list, never extend it |

```json
{
  "deepMaxTokens": 8192,
  "deepToolCallBudget": 4
}
```

The `deep*` names are older than the current behavior — there used to be a separate deep mode — and
are kept so existing config files keep working.

Two settings are accepted but do nothing: `quakeKeys` (the overlay shortcut is fixed) and
`cacheRetention` (always `short`). They are parsed rather than rejected so older config files do
not break.

## Where threads live

One file per project:

```
~/.pi/agent/btw/threads-<hash-of-cwd>.json
```

It is rewritten atomically, so a crash cannot corrupt it. Two pi sessions open in the same
directory will overwrite each other's threads — last write wins.

## What it will not do

The side agent is read-only. It never gets `write`, `edit`, or `bash` — only `read`, `grep`,
`find`, and `ls`, and the allowlist can only shrink that set.

That is deliberate, not a default you are meant to loosen. The side channel runs alongside the main
agent and calls tools internally, so a permission-gate extension never sees those calls and could
not stop them.

There is no web search or page fetching either, and none planned. pi has no web tool in core and no
way for one extension to borrow another's, so adding it would mean either reaching into another
extension's internals or writing SSRF-safe fetching from scratch — too much security surface for a
side-question tool. If pi ships a public tool-sharing API, this is worth revisiting.

## Removing and updating

```
pi remove npm:pi-btw-extension
pi update --extension npm:pi-btw-extension
```

## Development

```
npm run typecheck   # needs: npm i -g @earendil-works/pi-coding-agent
npm test            # 16 assertions across three suites
```

Confirm the package still loads under pi's own package rules:

```
pi --no-extensions -e "$PWD" -p 'reply with exactly: ok'
```

One trap worth knowing: **do not add `extensions/btw/index.ts`.** pi scans `extensions/` one level
deep and treats a subdirectory as an extension only when it contains an `index.ts`. Add one and
`/btw` gets registered twice.

## Prior art

| Project | What it does | Relation |
|---|---|---|
| [Fatih0234/btw](https://github.com/Fatih0234/btw) | Cache-warm shadow side questions | Where the cache-warm approach comes from |
| [peterp/pi-sidequest](https://github.com/peterp/pi-sidequest) | Threaded, persistent, tool-capable side channel | Where threads, persistence, and the overlay come from |
| [pi-psst](https://www.npmjs.com/package/pi-psst) | Ephemeral side questions | The same idea, kept simpler |

This one puts those together: cache-warm and threaded, with read-only tools when a question needs
them, grounded live rather than snapshotted, and opt-in promotion back to the main thread.

## License

MIT
