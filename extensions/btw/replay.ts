import type { BtwEntry, BtwState, BtwThread } from "./threads";

export type BtwDelta =
  | { v: 1; op: "thread-created"; thread: BtwThread }
  | { v: 1; op: "entry-appended"; threadId: string; entry: BtwEntry }
  | { v: 1; op: "active-set"; threadId: string }
  | { v: 1; op: "promoted"; threadId: string; entryId: string };

// Deliberately loose: reconstruct must accept whatever an old or foreign
// session file contains without depending on the installed SessionEntry type.
type SessionEntryLike = { type?: string; customType?: string; data?: unknown };

export const emptyState = (): BtwState => ({ version: 1, threads: [] });

/**
 * Apply one delta in place. Defensive by contract: an unknown op, malformed
 * payload, duplicate create, or dangling reference must be a no-op. One bad
 * line in the session file must never poison the rest of the replay.
 */
export function applyDelta(state: BtwState, delta: unknown): void {
  if (typeof delta !== "object" || delta === null) return;
  const d = delta as Record<string, unknown>;
  switch (d.op) {
    case "thread-created": {
      const t = d.thread as BtwThread | undefined;
      if (!t || typeof t.id !== "string" || !Array.isArray(t.entries)) return;
      if (state.threads.some((x) => x.id === t.id)) return;
      state.threads.push(structuredClone(t));
      state.activeThreadId = t.id; // mirrors ThreadStore.newThread()
      return;
    }
    case "entry-appended": {
      const id = d.threadId;
      const e = d.entry as BtwEntry | undefined;
      if (typeof id !== "string" || !e || typeof e.id !== "string") return;
      let t = state.threads.find((x) => x.id === id);
      if (!t) {
        // The create delta was lost: preserve the answer in a stub thread
        // rather than dropping user data.
        t = { id, createdAt: "", entries: [] };
        state.threads.push(t);
      }
      t.entries.push(structuredClone(e));
      return;
    }
    case "active-set": {
      if (typeof d.threadId !== "string") return;
      if (state.threads.some((x) => x.id === d.threadId)) state.activeThreadId = d.threadId;
      return;
    }
    case "promoted": {
      if (typeof d.threadId !== "string" || typeof d.entryId !== "string") return;
      const e = state.threads.find((x) => x.id === d.threadId)?.entries.find((x) => x.id === d.entryId);
      if (e) e.promoted = true;
      return;
    }
    default:
      return;
  }
}

/**
 * Rebuild BtwState from session entries: a `btw-state` snapshot is a reset
 * point (this is also what makes pre-delta sessions load unchanged), and each
 * `btw-delta` after it is replayed on top. Returns how many deltas follow the
 * last snapshot so the writer can keep its checkpoint cadence across reloads.
 */
export function reconstructFromEntries(entries: readonly SessionEntryLike[]): {
  state: BtwState;
  deltasSinceSnapshot: number;
} {
  let state = emptyState();
  let deltasSinceSnapshot = 0;
  for (const entry of entries) {
    if (!entry || entry.type !== "custom") continue;
    if (entry.customType === "btw-state") {
      try {
        const data = entry.data as BtwState | undefined;
        if (data && Array.isArray(data.threads)) {
          state = structuredClone(data);
          deltasSinceSnapshot = 0;
        }
      } catch {
        // corrupt snapshot → keep replaying from the previous state
      }
    } else if (entry.customType === "btw-delta") {
      try {
        applyDelta(state, entry.data);
      } catch {
        // corrupt delta → skip; blast radius ends here
      }
      deltasSinceSnapshot++;
    }
  }
  return { state, deltasSinceSnapshot };
}
