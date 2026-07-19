import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { reconstructFromEntries } from "./replay.ts";
import { cleanupOrphanTmp, loadStateFile, resolveStorePath, saveStateFile } from "./store-file.ts";

export type BtwEntry = {
  id: string;
  mode: "quick" | "deep";
  question: string;
  answer: string;
  grounding: { capturedAt: string; model: string; contextInfo: string };
  toolsUsed?: string[];
  promoted?: boolean;
  error?: string;
};
export type BtwThread = { id: string; createdAt: string; entries: BtwEntry[] };
export type BtwState = { version: 1; threads: BtwThread[]; activeThreadId?: string };

export interface ThreadStore {
  reconstruct(ctx: ExtensionContext): void;
  listThreads(): BtwThread[];
  getActive(): BtwThread | null;
  setActive(id: string): void;
  newThread(): BtwThread;
  deleteThread(id: string): void;
  append(threadId: string, entry: BtwEntry): void;
  tailDigest(threadId: string): string;
  markPromoted(threadId: string, entryId: string): void;
  nextId(): string;
}

export function createThreadStore(): ThreadStore {
  let state: BtwState = { version: 1, threads: [] };
  let counter = 0;

  // Monotonic, deterministic ids (Date.now/Math.random are unavailable in some
  // pi contexts and hurt reproducibility). Seed the counter past any restored id.
  const nextId = (): string => `e${++counter}`;
  const seedCounter = () => {
    for (const t of state.threads) {
      bump(t.id);
      for (const e of t.entries) bump(e.id);
    }
  };
  const bump = (id: string) => {
    const n = Number(id.replace(/^\D+/, ""));
    if (Number.isFinite(n) && n > counter) counter = n;
  };

  let storePath: string | null = null;
  // Set from ctx.ui.notify at reconstruct time so the UI-agnostic store can still
  // report a persistence failure. Fired at most once per store lifetime.
  let notifyPersistError: ((msg: string) => void) | null = null;
  let persistErrorNotified = false;
  const notePersistFailure = () => {
    if (persistErrorNotified) return;
    persistErrorNotified = true;
    notifyPersistError?.(
      "btw: couldn't save threads (read-only home or full disk?). This session's threads won't persist across sessions",
    );
  };

  // Every mutation rewrites the whole per-project file. It is small, the write is
  // atomic (tmp+rename), and JSON.stringify runs synchronously inside the save,
  // so no copy-on-write snapshotting is needed to guard against concurrent edits.
  const persist = () => {
    storePath ??= resolveStorePath(process.cwd());
    try {
      saveStateFile(storePath, state);
    } catch {
      // A read-only/full home must never crash the session: in-memory state is
      // already updated, so threads just degrade to session-scoped (held in
      // memory, not persisted across sessions).
      notePersistFailure();
    }
  };
  const find = (id: string) => state.threads.find((t) => t.id === id) ?? null;

  return {
    reconstruct(ctx) {
      storePath = resolveStorePath((ctx as { cwd?: string }).cwd ?? process.cwd());
      notifyPersistError = (msg) => {
        try {
          ctx.ui.notify(msg, "error");
        } catch {
          // Notify is best-effort; never let it break reconstruct.
        }
      };
      cleanupOrphanTmp(storePath);
      const fromFile = loadStateFile(storePath);
      if (fromFile) {
        state = fromFile;
      } else {
        // Migration: earlier sessions persisted threads as session custom
        // entries (btw-state/btw-delta) rather than a file. Replay those once
        // and seed the file so later loads take the fast path above.
        state = reconstructFromEntries(ctx.sessionManager.getEntries()).state;
        if (state.threads.length) {
          try {
            saveStateFile(storePath, state);
          } catch {
            // Same degradation as persist(): migration succeeds in memory.
            notePersistFailure();
          }
        }
      }
      counter = 0;
      seedCounter();
    },
    listThreads() {
      return state.threads;
    },
    getActive() {
      return state.activeThreadId ? find(state.activeThreadId) : null;
    },
    setActive(id) {
      if (find(id)) {
        state.activeThreadId = id;
        persist();
      }
    },
    newThread() {
      const t: BtwThread = { id: `t${nextId()}`, createdAt: new Date().toISOString(), entries: [] };
      state.threads.push(t);
      state.activeThreadId = t.id;
      persist();
      return t;
    },
    deleteThread(id) {
      const idx = state.threads.findIndex((t) => t.id === id);
      if (idx === -1) return;
      state.threads.splice(idx, 1);
      // Dropping the active thread clears the pointer; the overlay decides what
      // to show next rather than the store silently picking a replacement.
      if (state.activeThreadId === id) delete state.activeThreadId;
      persist();
    },
    append(threadId, entry) {
      const t = find(threadId);
      if (!t) return;
      t.entries.push(entry);
      persist();
    },
    tailDigest(threadId) {
      const t = find(threadId);
      if (!t || t.entries.length === 0) return "";
      // Fold prior Q/A into one text block; shadow.ts folds this into the current
      // question's UserMessage. Synthesizing an AssistantMessage is avoided:
      // AssistantMessage requires api/provider/model/usage/stopReason, which a
      // replayed history entry has no honest source for.
      return t.entries
        .map((e) => `Q: ${e.question}\nA: ${e.error ? `(error: ${e.error})` : e.answer}`)
        .join("\n\n");
    },
    markPromoted(threadId, entryId) {
      const e = find(threadId)?.entries.find((x) => x.id === entryId);
      if (e) {
        e.promoted = true;
        persist();
      }
    },
    nextId,
  };
}
