import assert from "node:assert";
import { test } from "node:test";
import { applyDelta, emptyState, reconstructFromEntries } from "../extensions/btw/replay.ts";

const entry = (id: string, q = "q", a = "a") => ({
  id, mode: "quick" as const, question: q, answer: a,
  grounding: { capturedAt: "", model: "m", contextInfo: "" },
});
const thread = (id: string) => ({ id, createdAt: "", entries: [] });
const custom = (customType: string, data: unknown) => ({ type: "custom", customType, data });

test("deltas only: create, append, promote, switch", () => {
  const { state } = reconstructFromEntries([
    custom("btw-delta", { v: 1, op: "thread-created", thread: thread("t1") }),
    custom("btw-delta", { v: 1, op: "entry-appended", threadId: "t1", entry: entry("e1") }),
    custom("btw-delta", { v: 1, op: "promoted", threadId: "t1", entryId: "e1" }),
    custom("btw-delta", { v: 1, op: "thread-created", thread: thread("t2") }),
    custom("btw-delta", { v: 1, op: "active-set", threadId: "t1" }),
  ]);
  assert.equal(state.threads.length, 2);
  assert.equal(state.threads[0].entries[0].promoted, true);
  assert.equal(state.activeThreadId, "t1");
});

test("snapshot resets state; later deltas apply on top", () => {
  const snap = { version: 1, threads: [{ ...thread("t9"), entries: [entry("e9")] }], activeThreadId: "t9" };
  const { state, deltasSinceSnapshot } = reconstructFromEntries([
    custom("btw-delta", { v: 1, op: "thread-created", thread: thread("t1") }),
    custom("btw-state", snap),
    custom("btw-delta", { v: 1, op: "entry-appended", threadId: "t9", entry: entry("e10") }),
  ]);
  assert.deepEqual(state.threads.map((t) => t.id), ["t9"]);
  assert.equal(state.threads[0].entries.length, 2);
  assert.equal(deltasSinceSnapshot, 1);
});

test("corrupt and unknown deltas are skipped without poisoning the rest", () => {
  const { state } = reconstructFromEntries([
    custom("btw-delta", "garbage"),
    custom("btw-delta", { v: 1, op: "no-such-op", anything: true }),
    custom("btw-delta", { v: 1, op: "thread-created", thread: { id: 42 } }),
    custom("btw-delta", { v: 1, op: "thread-created", thread: thread("t1") }),
  ]);
  assert.deepEqual(state.threads.map((t) => t.id), ["t1"]);
});

test("entry-appended to a missing thread creates a stub (data preserved)", () => {
  const { state } = reconstructFromEntries([
    custom("btw-delta", { v: 1, op: "entry-appended", threadId: "lost", entry: entry("e1") }),
  ]);
  assert.equal(state.threads[0].id, "lost");
  assert.equal(state.threads[0].entries[0].id, "e1");
});

test("duplicate thread-created and dangling active-set/promoted are no-ops", () => {
  const s = emptyState();
  applyDelta(s, { v: 1, op: "thread-created", thread: thread("t1") });
  applyDelta(s, { v: 1, op: "thread-created", thread: thread("t1") });
  applyDelta(s, { v: 1, op: "active-set", threadId: "nope" });
  applyDelta(s, { v: 1, op: "promoted", threadId: "t1", entryId: "nope" });
  assert.equal(s.threads.length, 1);
  assert.equal(s.activeThreadId, "t1"); // thread-created mirrors newThread(): sets active
});

test("old-format sessions (snapshots only): last snapshot wins", () => {
  const { state } = reconstructFromEntries([
    custom("btw-state", { version: 1, threads: [thread("a")] }),
    custom("btw-state", { version: 1, threads: [thread("b")], activeThreadId: "b" }),
    { type: "message" },
  ]);
  assert.deepEqual(state.threads.map((t) => t.id), ["b"]);
  assert.equal(state.activeThreadId, "b");
});

test("replayed state does not alias the input entry payloads", () => {
  const t = thread("t1");
  const { state } = reconstructFromEntries([custom("btw-delta", { v: 1, op: "thread-created", thread: t })]);
  state.threads[0].entries.push(entry("e1"));
  assert.equal(t.entries.length, 0);
});
