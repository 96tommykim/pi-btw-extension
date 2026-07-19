# pi-btw-extension

A [pi](https://github.com/badlogic/pi-mono) extension that adds a `/btw` side channel for
questions you don't want in the main transcript.

`/btw` answers in an overlay using the context the main session already has, and writes nothing
back unless you explicitly share an answer.

## What it does

Ask while the main agent is mid-task:

```
/btw what does this error actually mean?
/btw summarize what we have changed so far
/btw where is retryPolicy used?
```

The first two are answered from session context alone. The third makes the side agent read files.
It decides per question; there is no separate command for the tool-using case.

## Install

```
pi install npm:pi-btw-extension
```

Requires pi and Node 22.19+. pi bundles the packages this imports, so there is nothing else to
install.

```
pi remove npm:pi-btw-extension
pi update --extension npm:pi-btw-extension
```

## Usage

| Key or command | Action |
|---|---|
| `/btw <question>` | Ask; opens the overlay |
| `/btw` | Reopen the last thread |
| `Ctrl+Alt+B` | Toggle the overlay |
| `Ctrl+L` / `Ctrl+N` | Thread list / new thread |
| `Ctrl+P` | Share an answer with the main agent |

`Ctrl+Alt+B` is Ctrl+Option+B on macOS. Terminals that don't send Option as Meta never deliver it.
Terminal.app doesn't by default, so use `/btw` there.

`Ctrl+P` puts a cursor on the answers you haven't shared yet:

| Key | Action |
|---|---|
| `↑` `↓` | Select |
| `Enter` | Share the selected answer |
| `a` | Share the whole thread |
| `r` | Rewrite as a short summary, then share |
| `Esc` | Cancel |

Shared answers arrive in the main conversation as a single `[/btw note ...]` message. Sharing does
not start a turn; the note is there on the agent's next one.

## How it works

The side question is sent with the main session's own system prompt and message prefix, so the
provider's prompt cache stays warm and you pay for the question rather than for a second context.
The extension recaptures that prefix on every main turn, so answers reflect the session's current
state rather than a snapshot from when the thread was opened.

Threads are stored per project, one file each:

```
~/.pi/agent/btw/threads-<hash-of-cwd>.json
```

Writes are atomic (temp file plus rename), so an interrupted write cannot corrupt the store. Two pi
sessions in the same directory will overwrite each other's threads. Last write wins.

## Configuration

Environment variables take precedence, then `~/.pi/agent/btw.json`, then these defaults:

| Setting | Default | Environment variable | Notes |
|---|---|---|---|
| `answerMaxTokens` | `4096` | `BTW_ANSWER_MAX_TOKENS` | Caps every answer |
| `refineMaxTokens` | `1024` | `BTW_REFINE_MAX_TOKENS` | Caps the `r` summary only |
| `toolCallBudget` | `8` | `BTW_TOOL_BUDGET` | Tool calls per ask before it wraps up |
| `toolAllowlist` | `["read","grep","find","ls"]` | None | Narrows the built-in set; cannot extend it |

```json
{
  "answerMaxTokens": 8192,
  "toolCallBudget": 4
}
```

Unknown keys are ignored, so an older `btw.json` keeps loading.

## Limitations

The side agent is read-only. It gets `read`, `grep`, `find`, and `ls`, never `write`, `edit`, or
`bash`, and `toolAllowlist` can only narrow that set. This is not a default to loosen: the side
channel runs alongside the main agent and executes tools internally, so pi's tool-call gate events
never fire for them and a permission-gate extension cannot see or block them.

There is no web search or page fetching, and none planned. pi has no web tool in core and no public
API for one extension to reuse another's tools, so adding it would mean either importing another
extension's internals or reimplementing SSRF-safe fetching here. If pi ships a tool-sharing API,
this is worth revisiting.

## Development

```
npm run typecheck   # needs: npm i -g @earendil-works/pi-coding-agent typescript
npm test            # 17 tests across three suites
```

To check the package still loads under pi's package rules:

```
pi --no-extensions -e "$PWD" -p 'reply with exactly: ok'
```

The entry point is `index.ts` at the package root, and everything it uses lives in `lib/`. The
`pi.extensions` manifest in `package.json` names that one file explicitly, and an explicit
manifest is authoritative: pi loads exactly the files it lists and never scans the package for
more. So new modules can be added to `lib/` freely, and only `index.ts` decides what is
registered.

## License

MIT
