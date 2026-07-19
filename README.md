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

Mid-task, ask something you don't want to add to the main transcript:

```
/btw what does this error actually mean?
/btw summarize what we have changed so far
/btw where is retryPolicy used?
```

The first two are answered straight from the session context. The third sends the side agent off
to read files. It chooses automatically, so there's no separate `deep` command to remember.

## Using it

| Key or command | What it does |
|---|---|
| `/btw <question>` | Ask. Opens the overlay. |
| `/btw` | Reopen the last thread. |
| `Ctrl+Alt+B` | Toggle the overlay. |
| `Ctrl+L` / `Ctrl+N` | Thread list / new thread. |
| `Ctrl+P` | Share an answer with the main agent. |

On macOS, `Ctrl+Alt+B` is Ctrl+Option+B. If your terminal doesn't send Option as Meta, the
shortcut won't reach pi. Terminal.app doesn't do this by default, so use `/btw` instead.

`Ctrl+P` puts a cursor on the answers you have not shared yet:

| Key | What it does |
|---|---|
| `↑` `↓` | Pick one |
| `Enter` | Share it |
| `a` | Share the whole thread |
| `r` | Rewrite it as a short summary, then share that |
| `Esc` | Never mind |

A shared answer arrives as a `[/btw note ...]` message. That tag tells the main agent where the
answer came from. Sharing doesn't start a turn. The note is there the next time the agent speaks.

## Why it stays cheap

The side question reuses the main session's exact prompt prefix and system prompt. That keeps the
provider's cache warm, so you pay for the question, not a second context. The extension recaptures
that prefix every main turn. Answers use what the agent knows *now*, not what it knew when you
opened the thread.

## Configuration

Environment variables win, then `~/.pi/agent/btw.json`, then these defaults:

| Setting | Default | Environment variable | Notes |
|---|---|---|---|
| `answerMaxTokens` | `4096` | `BTW_ANSWER_MAX_TOKENS` | Caps every answer |
| `refineMaxTokens` | `1024` | `BTW_REFINE_MAX_TOKENS` | Caps only the `r` summary |
| `toolCallBudget` | `8` | `BTW_TOOL_BUDGET` | Tool calls per ask before it wraps up |
| `toolAllowlist` | `["read","grep","find","ls"]` | None | Can only narrow this list, never extend it |

```json
{
  "answerMaxTokens": 8192,
  "toolCallBudget": 4
}
```

Unknown keys are ignored, so an older `btw.json` keeps loading.

## Where threads live

One file per project:

```
~/.pi/agent/btw/threads-<hash-of-cwd>.json
```

It is rewritten atomically, so a crash can't corrupt it. Two pi sessions open in the same
directory will overwrite each other's threads. The last write wins.

## What it won't do

The side agent is read-only. It gets `read`, `grep`, `find`, and `ls`, but not `write`, `edit`,
or `bash`. The allowlist can only shrink that set.

That is deliberate, not a default you are meant to loosen. The side channel runs alongside the main
agent and calls tools internally, so a permission-gate extension never sees those calls and can't
stop them.

Web search and page fetching aren't supported, and there are no plans to add them. pi has no
built-in web tool, and extensions can't borrow each other's tools. Adding secure fetching here
would add too much complexity for a side-question tool. If pi adds a public tool-sharing API, web
support could make sense here later.

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

## License

MIT
