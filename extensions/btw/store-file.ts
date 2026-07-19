import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { BtwState } from "./threads";

/**
 * Cross-session thread store: one JSON file per project (keyed by cwd hash)
 * under the pi agent home. BTW_SPEC §6.2 (V2b).
 */
export function resolveStorePath(cwd: string, home: string = homedir()): string {
  const key = createHash("sha256").update(cwd).digest("hex").slice(0, 12);
  return join(home, ".pi", "agent", "btw", `threads-${key}.json`);
}

/** Missing/corrupt/foreign file → null (caller falls back to session replay). */
export function loadStateFile(path: string): BtwState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const s = parsed as Partial<BtwState>;
    if (!Array.isArray(s.threads)) return null;
    return {
      version: 1,
      threads: s.threads,
      ...(typeof s.activeThreadId === "string" ? { activeThreadId: s.activeThreadId } : {}),
    };
  } catch {
    return null;
  }
}

/** Atomic write (tmp + rename) so a crash mid-write never corrupts the store. */
export function saveStateFile(path: string, state: BtwState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, path);
}

/**
 * Best-effort removal of a crash-orphaned temp file (a `<path>.tmp` left when a
 * process died between write and rename). Harmless if absent; a leftover would
 * be overwritten by the next save anyway, so failure to remove is ignored.
 */
export function cleanupOrphanTmp(path: string): void {
  try {
    rmSync(`${path}.tmp`, { force: true });
  } catch {
    // Best-effort only.
  }
}
