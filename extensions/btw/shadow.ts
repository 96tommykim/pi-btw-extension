import { complete } from "@earendil-works/pi-ai/compat";
import type { Message, UserMessage } from "@earendil-works/pi-ai/compat";
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BtwSettings } from "./config";

const SIDE_SAFETY = `You are answering a SIDE QUESTION about the current coding session.
You MAY use the read-only tools (read, grep, find, ls) to investigate the codebase when the answer needs it.
Rules:
- Prefer answering directly from the conversation context above plus your general knowledge; use tools only when that is insufficient.
- Use tools ONLY to answer this side question. Make NO edits, run NO shell commands, and do not use write/edit tools (you do not have them).
- Do NOT continue, plan, or perform the user's main task.
- Use as few tool calls as possible.
- If you still cannot determine the answer, say so plainly.
Keep the answer concise.`;

export function buildSideQuestion(question: string, priorDigest?: string): UserMessage {
  const prior = priorDigest ? `Earlier in this side thread:\n${priorDigest}\n\n` : "";
  return {
    role: "user",
    content: [{ type: "text", text: `${prior}${SIDE_SAFETY}\n\nSide question: ${question}` }],
    timestamp: Date.now(),
  };
}

export type SideResult = { text: string; aborted: boolean; error?: string; toolsUsed: string[] };

type ToolResultMsg = Extract<Message, { role: "toolResult" }>;
function toolResultMsg(id: string, name: string, text: string, isError: boolean): ToolResultMsg {
  return { role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], isError, timestamp: Date.now() };
}

export async function runSide(
  ctx: ExtensionContext,
  opts: { prefix: Message[]; tail?: string; question: string; settings: BtwSettings; signal: AbortSignal },
): Promise<SideResult> {
  const model = ctx.model;
  if (!model) return { text: "", aborted: false, error: "No model selected", toolsUsed: [] };

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    return { text: "", aborted: false, toolsUsed: [], error: auth.error };
  }

  const cwd = (ctx as { cwd?: string }).cwd ?? process.cwd();
  const allDefs = [
    createReadToolDefinition(cwd),
    createGrepToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createLsToolDefinition(cwd),
  ];
  const allowed = allDefs.filter((t) => opts.settings.toolAllowlist.includes(t.name));
  const defByName = new Map(allowed.map((t) => [t.name, t] as const));
  const tools = allowed.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const budget = opts.settings.toolCallBudget;

  const messages: Message[] = [...opts.prefix, buildSideQuestion(opts.question, opts.tail)];
  const toolsUsed = new Set<string>();
  let toolCallCount = 0;
  let iterations = 0;

  try {
    while (true) {
      if (opts.signal.aborted) return { text: "", aborted: true, toolsUsed: [...toolsUsed] };

      // Once the budget is spent, drop tools so the model is forced to answer.
      const budgetSpent = toolCallCount >= budget;
      const activeTools = budgetSpent ? [] : tools;

      const response = await complete(
        model,
        { systemPrompt: ctx.getSystemPrompt(), messages, tools: activeTools },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          env: auth.env,
          maxTokens: opts.settings.answerMaxTokens,
          cacheRetention: "short",
          signal: opts.signal,
        },
      );
      if (response.stopReason === "aborted") return { text: "", aborted: true, toolsUsed: [...toolsUsed] };
      messages.push(response);

      const calls = response.content.filter(
        (c): c is { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> } =>
          c.type === "toolCall",
      );

      if (calls.length === 0) {
        const text = response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        const notice = budgetSpent ? `\n\n_(stopped after the ${budget}-tool-call budget)_` : "";
        return { text: text + notice, aborted: false, toolsUsed: [...toolsUsed] };
      }

      // Every toolCall in the batch needs a matching toolResult before the next complete().
      for (const call of calls) {
        const def = defByName.get(call.name);
        if (!def) {
          messages.push(toolResultMsg(call.id, call.name, `Tool "${call.name}" is not available.`, true));
          continue;
        }
        if (toolCallCount >= budget) {
          messages.push(toolResultMsg(call.id, call.name, `Tool-call budget of ${budget} reached. Answer now from what you have.`, true));
          continue;
        }
        toolCallCount++;
        toolsUsed.add(call.name);
        try {
          const r = await def.execute(call.id, call.arguments as never, opts.signal, undefined, ctx);
          messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: r.content, isError: false, timestamp: Date.now() });
        } catch (e) {
          messages.push(toolResultMsg(call.id, call.name, e instanceof Error ? e.message : String(e), true));
        }
      }

      // Safety net against a pathological non-terminating model (should not trigger:
      // once budget is spent activeTools=[] forces a final text answer next pass).
      if (++iterations > budget + 3) {
        const text = messages
          .filter((m): m is Extract<Message, { role: "assistant" }> => m.role === "assistant")
          .flatMap((m) => m.content)
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        return { text: text || "Stopped: deep investigation exceeded its step limit.", aborted: false, toolsUsed: [...toolsUsed] };
      }
    }
  } catch (err) {
    return { text: "", aborted: false, toolsUsed: [...toolsUsed], error: err instanceof Error ? err.message : String(err) };
  }
}

const REFINE_INSTRUCTION = `Rewrite the side Q/A below into a short note for the agent working on the main task.
Rules:
- Keep ONLY what helps the main task: the conclusion, key facts, decisions, and file/symbol references.
- Drop hedging, restated context, and exploration narrative.
- At most 6 lines. No preamble, no sign-off — output the note body only.`;

export type QuickResult = { text: string; aborted: boolean; error?: string };

/** One quick pass that rewrites a promoted Q/A into a main-actionable note (§11 refine-on-promote). */
export async function runRefine(
  ctx: ExtensionContext,
  opts: { prefix: Message[]; question: string; answer: string; settings: BtwSettings; signal: AbortSignal },
): Promise<QuickResult> {
  const model = ctx.model;
  if (!model) return { text: "", aborted: false, error: "No model selected" };

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) return { text: "", aborted: false, error: auth.error };

  const refineMsg: UserMessage = {
    role: "user",
    content: [{ type: "text", text: `${REFINE_INSTRUCTION}\n\nQ: ${opts.question}\nA: ${opts.answer}` }],
    timestamp: Date.now(),
  };
  const messages: Message[] = [...opts.prefix, refineMsg];

  try {
    const response = await complete(
      model,
      { systemPrompt: ctx.getSystemPrompt(), messages, tools: [] },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        env: auth.env,
        maxTokens: opts.settings.refineMaxTokens,
        cacheRetention: "short",
        signal: opts.signal,
      },
    );
    if (response.stopReason === "aborted") return { text: "", aborted: true };
    const text = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return { text: text.trim(), aborted: false };
  } catch (err) {
    return { text: "", aborted: false, error: err instanceof Error ? err.message : String(err) };
  }
}
