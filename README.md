# pi-btw-extension

`/btw` lets you ask a side question inside a [pi](https://github.com/badlogic/pi-mono) session
without writing anything to the main conversation history or interrupting the task the main
agent is running. It opens an overlay, answers grounded in your current session, and — only if
you choose — lets you promote the answer back into the main thread.

Three things distinguish it from a plain "ask a second question" helper:

- **Cache-warm.** The side question reuses the main session's exact provider message prefix and
  system prompt, so the provider's prompt cache stays warm instead of paying for a cold second
  context on every ask.
- **Live grounding, not a snapshot.** Every ask re-reads the current state of the main
  conversation, so answers reflect what the main agent knows *right now*, not what it knew when
  the side thread was opened.
- **Threads that persist.** Side conversations are threaded and saved to disk per project, so
  they survive across pi sessions in the same directory, not just within one running process.

## Install

```
pi install npm:pi-btw-extension
```

pi bundles the packages this extension depends on (`@earendil-works/pi-coding-agent`,
`@earendil-works/pi-ai`, `@earendil-works/pi-tui`), so there is nothing else to install.

## Usage

```
/btw <question>
```

Ask a side question. It is answered grounded in the current main session, in an overlay — the
main conversation is untouched.

```
/btw
```

With no argument, `/btw` reopens the last thread instead of prompting for a new question.

The Quake key (default backtick `` ` ``) toggles the overlay open and closed without going
through the command palette.

Inside the overlay you can navigate between threads and scroll a thread's history. To share an
answer with the main agent, press `Ctrl+P` to arm select mode:

| Key | Action |
|---|---|
| `↑` `↓` | Move the selection cursor over promotable Q/A entries |
| `Enter` | Share the selected Q/A |
| `a` | Share the whole thread |
| `r` | Refine the selection into a short summary, then share it |
| `Esc` | Cancel select mode |

## How it works

The shadow pass that answers your `/btw` question uses the same system prompt and the same live
message prefix as the main agent, which is what keeps the provider's prompt cache warm — only
the side question itself (and any tool calls it triggers) is new input. Because the prefix is
recaptured on every main-agent turn, each `/btw` ask sees the latest main context, not a snapshot
frozen at thread-open time.

Nothing from a `/btw` thread reaches the main conversation unless you explicitly promote it. A
promoted answer arrives as a single, self-describing message — `[/btw note …]` — so the main
model understands where it came from without any prior knowledge of the extension.

## Configuration

Settings are resolved with **environment variables taking precedence**, falling back to
`~/.pi/agent/btw.json`, and finally to the built-in defaults below.

| Setting | Default | Environment variable | Notes |
|---|---|---|---|
| `quakeKeys` | ``["`"]`` | `BTW_QUAKE_KEYS` | Comma-separated list of keys that toggle the overlay |
| `maxTokens` | `1024` | `BTW_MAX_TOKENS` | Caps only the refine-on-promote pass |
| `deepMaxTokens` | `4096` | `BTW_DEEP_MAX_TOKENS` | Caps the answer for every `/btw` ask |
| `deepToolAllowlist` | `["read","grep","find","ls"]` | — | Read-only tools the side agent may call |
| `deepToolCallBudget` | `8` | `BTW_DEEP_BUDGET` | Maximum tool calls per ask before a partial answer is returned |

The `deep*` names predate the current automatic mode, where every `/btw` ask can call tools if it
needs to — there is no longer a separate "deep" trigger. The names are kept as-is for backwards
compatibility with existing configuration files. `deepMaxTokens` caps the answer for every ask;
`maxTokens` only caps the length of the refined summary produced when you press `r` in select
mode.

## Where your threads live

Threads are stored outside the pi session, one JSON file per project, at:

```
~/.pi/agent/btw/threads-<hash-of-cwd>.json
```

The file is rewritten atomically on every change (write to a temp file, then rename), so a crash
mid-write cannot corrupt it. This gives threads two properties worth knowing about:

- If you have two pi sessions open in the same project at once, the store is last-write-wins —
  the two sessions do not merge their writes.
- If a project already had `/btw` threads before this store file existed, those older threads
  are not merged into it; the store starts fresh going forward.

## Safety

The side agent that answers `/btw` questions is **read-only**. It never receives `write`,
`edit`, or `bash` — only a small allowlist of read-only tools (`read`, `grep`, `find`, `ls`).

Giving the side agent the main agent's full toolset was considered and rejected: the side channel
runs concurrently with the main agent and executes its tools internally, so a permission-gate
extension a user has installed to approve or deny tool calls would never see those calls and
could not protect against them. The read-only restriction is a hard invariant, not a default you
are expected to loosen.

## Not planned: web tools

`/btw` does not have web search or page-fetching, and there is no near-term plan to add it. The
honest reason: pi has no web tool in its core toolset, and no public API for one extension to
reuse another extension's tools. Adding web access to `/btw` would mean either hard-importing a
separate web-access extension's private internals — which breaks self-containment and portability
— or reimplementing search and SSRF-safe fetching from scratch inside this extension, which is a
disproportionate amount of security surface for a side-question tool. Neither is justified today.
This will be revisited if pi ships a public inter-extension tool-sharing API that lets `/btw`
reuse an existing web tool's implementation instead of building its own.

## Development

```
npm run typecheck   # requires: npm i -g @earendil-works/pi-coding-agent
npm test             # 16 assertions across three suites
```

To confirm the package loads correctly under pi's own package rules:

```
pi --no-extensions -e "$PWD" -p 'reply with exactly: ok'
```

## Prior art

| Project | What it does | How this extension relates |
|---|---|---|
| [Fatih0234/btw](https://github.com/Fatih0234/btw) | Cache-warm shadow side questions | Source of the cache-warm approach this extension builds on |
| [peterp/pi-sidequest](https://github.com/peterp/pi-sidequest) | Threaded, persistent, tool-capable side channel with a Quake overlay | Source of the threading, persistence, and overlay ideas |
| [pi-psst](https://www.npmjs.com/package/pi-psst) | Ephemeral side questions modeled on Claude Code's `/btw` | Confirms the side-channel pattern this extension follows |

This extension combines the cache-warm shadow core with persistent threads, on-demand read-only
tools, live (not snapshotted) grounding, and opt-in promote-to-main — a combination none of the
projects above ship on their own.

## License

MIT
