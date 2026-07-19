import assert from "node:assert";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { cleanupOrphanTmp, loadStateFile, resolveStorePath, saveStateFile } from "../lib/store-file.ts";

const dir = mkdtempSync(join(tmpdir(), "btw-store-"));
const state = {
  version: 1 as const,
  threads: [{ id: "te1", createdAt: "2026-07-19T00:00:00.000Z", entries: [] }],
  activeThreadId: "te1",
};

test("resolveStorePath is deterministic per cwd and lives under the pi home", () => {
  const a = resolveStorePath("/proj/a", "/home/u");
  assert.equal(a, resolveStorePath("/proj/a", "/home/u"));
  assert.notEqual(a, resolveStorePath("/proj/b", "/home/u"));
  assert.ok(a.startsWith(join("/home/u", ".pi", "agent", "btw") + sep));
  assert.match(a, /threads-[0-9a-f]{12}\.json$/);
});

test("save → load round-trips the state", () => {
  const p = join(dir, "roundtrip.json");
  saveStateFile(p, state);
  assert.deepEqual(loadStateFile(p), state);
});

test("save creates missing parent directories", () => {
  const p = join(dir, "nested", "deeper", "s.json");
  saveStateFile(p, state);
  assert.deepEqual(loadStateFile(p), state);
});

test("save writes the store owner-only, even over a world-readable orphan tmp", () => {
  const p = join(dir, "perms", "s.json");
  saveStateFile(p, state);
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, "perms")).mode & 0o777, 0o700);

  // A crash-orphaned tmp left world-readable by an earlier version must not
  // derail the save: the result is still owner-only, and the tmp is gone.
  // (saveStateFile removes the tmp before writing so the conversation never
  // occupies a 0644 file mid-write; that window is not observable after the
  // fact, so it is guarded by the rmSync in the code rather than asserted here.)
  writeFileSync(`${p}.tmp`, "stale", { mode: 0o644 });
  saveStateFile(p, { ...state, activeThreadId: "te2" });
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.equal(existsSync(`${p}.tmp`), false);
  assert.equal(loadStateFile(p)?.activeThreadId, "te2");
});

test("missing, corrupt, and foreign-shape files load as null", () => {
  assert.equal(loadStateFile(join(dir, "absent.json")), null);
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  assert.equal(loadStateFile(bad), null);
  const foreign = join(dir, "foreign.json");
  writeFileSync(foreign, JSON.stringify({ version: 1, threads: "nope" }));
  assert.equal(loadStateFile(foreign), null);
});

test("load drops a non-string activeThreadId but keeps threads", () => {
  const p = join(dir, "active.json");
  writeFileSync(p, JSON.stringify({ version: 1, threads: [], activeThreadId: 7 }));
  assert.deepEqual(loadStateFile(p), { version: 1, threads: [] });
});

test("cleanupOrphanTmp removes only the temp file, never the store, and is a no-op when absent", () => {
  const p = join(dir, "orphan.json");
  writeFileSync(p, JSON.stringify(state)); // the real store must survive
  writeFileSync(`${p}.tmp`, "half-written");
  assert.equal(existsSync(`${p}.tmp`), true);
  cleanupOrphanTmp(p);
  assert.equal(existsSync(`${p}.tmp`), false);
  assert.equal(existsSync(p), true); // store file untouched
  cleanupOrphanTmp(p); // absent → must not throw
});
