import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildSessionContext, convertToLlm } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai/compat";

export type Grounding = { getGroundingPrefix(ctx: ExtensionContext): Message[] };

/**
 * Register a read-only `context` listener that caches the latest converted
 * provider message prefix on every context build. Returns an accessor for the
 * live prefix. The handler returns nothing, so the main context passes through
 * unchanged (ContextEventResult fields are optional).
 */
export function registerGrounding(pi: ExtensionAPI): Grounding {
  let latestPrefix: Message[] = [];
  pi.on("context", (event) => {
    latestPrefix = convertToLlm(event.messages);
  });
  return {
    getGroundingPrefix(ctx) {
      if (latestPrefix.length > 0) return latestPrefix;
      // BTW_SPEC §5.1 step 2: before the first `context` event of a (resumed)
      // session, rebuild the prefix from persisted history so /btw is never
      // sent ungrounded. Not cached: the live listener takes over on turn 1.
      try {
        const sm = ctx.sessionManager;
        return convertToLlm(buildSessionContext(sm.getEntries(), sm.getLeafId()).messages);
      } catch {
        return [];
      }
    },
  };
}
