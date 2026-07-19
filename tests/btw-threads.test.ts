import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Redirect the per-project store under a throwaway HOME before importing the
// store module, so persist() writes into the temp tree and not the real ~/.pi.
process.env.HOME = mkdtempSync(join(tmpdir(), "btw-home-"));

const { createThreadStore } = await import("../lib/threads.ts");
const { loadStateFile, resolveStorePath } = await import("../lib/store-file.ts");

test("deleteThread removes only the named thread and keeps the active pointer", () => {
  const store = createThreadStore();
  const a = store.newThread();
  const b = store.newThread(); // newThread sets the newest active, so b is active
  store.deleteThread(a.id);
  assert.deepEqual(store.listThreads().map((t) => t.id), [b.id]);
  assert.equal(store.getActive()?.id, b.id);
});

test("deleting the active thread clears the active pointer", () => {
  const store = createThreadStore();
  const a = store.newThread();
  const b = store.newThread();
  store.deleteThread(b.id); // b is active
  assert.equal(store.getActive(), null);
  assert.deepEqual(store.listThreads().map((t) => t.id), [a.id]);
});

test("deleting the last thread empties the store", () => {
  const store = createThreadStore();
  const a = store.newThread();
  store.deleteThread(a.id);
  assert.deepEqual(store.listThreads(), []);
  assert.equal(store.getActive(), null);
});

test("deleting an unknown id is a no-op", () => {
  const store = createThreadStore();
  const a = store.newThread();
  store.deleteThread("does-not-exist");
  assert.deepEqual(store.listThreads().map((t) => t.id), [a.id]);
  assert.equal(store.getActive()?.id, a.id);
});

test("a delete is persisted to the store file", () => {
  const store = createThreadStore();
  const a = store.newThread();
  const b = store.newThread();
  store.deleteThread(a.id);
  const onDisk = loadStateFile(resolveStorePath(process.cwd()));
  assert.deepEqual(onDisk?.threads.map((t) => t.id), [b.id]);
});
