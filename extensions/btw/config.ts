import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BtwSettings = {
  answerMaxTokens: number; // caps every /btw answer
  refineMaxTokens: number; // caps only the refine-on-promote pass
  toolAllowlist: string[];
  toolCallBudget: number;
};

const DEFAULTS: BtwSettings = {
  answerMaxTokens: 4096,
  refineMaxTokens: 1024,
  toolAllowlist: ["read", "grep", "find", "ls"],
  toolCallBudget: 8,
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

  if (env.BTW_ANSWER_MAX_TOKENS && Number.isFinite(Number(env.BTW_ANSWER_MAX_TOKENS))) {
    merged.answerMaxTokens = Number(env.BTW_ANSWER_MAX_TOKENS);
  }
  if (env.BTW_REFINE_MAX_TOKENS && Number.isFinite(Number(env.BTW_REFINE_MAX_TOKENS))) {
    merged.refineMaxTokens = Number(env.BTW_REFINE_MAX_TOKENS);
  }
  if (env.BTW_TOOL_BUDGET && Number.isFinite(Number(env.BTW_TOOL_BUDGET))) {
    merged.toolCallBudget = Number(env.BTW_TOOL_BUDGET);
  }

  // Sanitize: a malformed btw.json/env must never yield NaN/0/wrong-typed settings that
  // silently defeat the tool budget cap (three termination guards in runSide) or the
  // answer-length cap. Any invalid field falls back to its default.
  return {
    answerMaxTokens: posInt(merged.answerMaxTokens) ?? DEFAULTS.answerMaxTokens,
    refineMaxTokens: posInt(merged.refineMaxTokens) ?? DEFAULTS.refineMaxTokens,
    toolAllowlist: stringArray(merged.toolAllowlist) ?? DEFAULTS.toolAllowlist,
    toolCallBudget: posInt(merged.toolCallBudget) ?? DEFAULTS.toolCallBudget,
  };
}
