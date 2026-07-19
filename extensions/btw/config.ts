import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BtwSettings = {
  quakeKeys: string[]; // forward-looking; M1 binds a fixed Ctrl+Alt+B (see ui.ts)
  maxTokens: number;
  deepMaxTokens: number; // final-answer cap for deep asks only; quick keeps maxTokens
  cacheRetention: "short";
  deepToolAllowlist: string[];
  deepToolCallBudget: number;
};

const DEFAULTS: BtwSettings = {
  quakeKeys: ["`"],
  maxTokens: 1024,
  deepMaxTokens: 4096,
  cacheRetention: "short",
  deepToolAllowlist: ["read", "grep", "find", "ls"],
  deepToolCallBudget: 8,
};

function readJsonFile(path: string): Partial<BtwSettings> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    // Only a plain object can supply settings; an array/primitive/null → defaults.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Partial<BtwSettings>) : {};
  } catch {
    return {}; // missing/invalid file → defaults
  }
}

/** A finite integer ≥ 1, else undefined — a malformed value must not defeat a cap. */
function posInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : undefined;
}
function stringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
}

export function getConfig(): BtwSettings {
  const fileCfg = readJsonFile(join(homedir(), ".pi", "agent", "btw.json"));
  const merged: BtwSettings = { ...DEFAULTS, ...fileCfg };
  const env = process.env;

  if (env.BTW_QUAKE_KEYS) {
    merged.quakeKeys = env.BTW_QUAKE_KEYS.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (env.BTW_MAX_TOKENS && Number.isFinite(Number(env.BTW_MAX_TOKENS))) {
    merged.maxTokens = Number(env.BTW_MAX_TOKENS);
  }
  if (env.BTW_DEEP_MAX_TOKENS && Number.isFinite(Number(env.BTW_DEEP_MAX_TOKENS))) {
    merged.deepMaxTokens = Number(env.BTW_DEEP_MAX_TOKENS);
  }
  if (env.BTW_DEEP_BUDGET && Number.isFinite(Number(env.BTW_DEEP_BUDGET))) {
    merged.deepToolCallBudget = Number(env.BTW_DEEP_BUDGET);
  }

  // Sanitize: a malformed btw.json/env must never yield NaN/0/wrong-typed settings that
  // silently defeat the tool budget cap (three termination guards in runSide) or the
  // answer-length cap. Any invalid field falls back to its default.
  const quakeKeys = stringArray(merged.quakeKeys)?.filter(Boolean);
  return {
    quakeKeys: quakeKeys && quakeKeys.length ? quakeKeys : DEFAULTS.quakeKeys,
    maxTokens: posInt(merged.maxTokens) ?? DEFAULTS.maxTokens,
    deepMaxTokens: posInt(merged.deepMaxTokens) ?? DEFAULTS.deepMaxTokens,
    cacheRetention: "short", // fixed by design (§6.1)
    deepToolAllowlist: stringArray(merged.deepToolAllowlist) ?? DEFAULTS.deepToolAllowlist,
    deepToolCallBudget: posInt(merged.deepToolCallBudget) ?? DEFAULTS.deepToolCallBudget,
  };
}
