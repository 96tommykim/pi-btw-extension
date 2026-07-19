import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { registerGrounding } from "./btw/context";
import { sendPromote } from "./btw/promote";
import { createThreadStore } from "./btw/threads";
import { openOverlay } from "./btw/ui";

export default function (pi: ExtensionAPI) {
  const grounding = registerGrounding(pi);
  const threads = createThreadStore();
  const onPromote = (note: string) => sendPromote(pi, note);

  // Rebuild persisted threads on load and after /reload or branch switches.
  pi.on("session_start", async (_event, ctx) => threads.reconstruct(ctx));
  pi.on("session_tree", async (_event, ctx) => threads.reconstruct(ctx));

  pi.registerCommand("btw", {
    description:
      "Ask a side question grounded in the current session (auto-investigates with read-only tools when needed; writes nothing to history)",
    handler: async (args, ctx) => {
      await openOverlay(ctx, threads, grounding, args, onPromote);
    },
  });

  // Overlay key: a fixed, conflict-free Ctrl+Alt+B. Not configurable — see the README.
  // Key.ctrlAlt yields the literal "ctrl+alt+b", and pi-tui keeps `alt` and `super`
  // distinct with no platform remapping, so on macOS this is Ctrl+Option+B (NOT Cmd);
  // a terminal that does not send Option as Meta never delivers it — use /btw instead.
  pi.registerShortcut(Key.ctrlAlt("b"), {
    description: "btw: open the side-question overlay",
    handler: async (ctx) => {
      await openOverlay(ctx, threads, grounding, undefined, onPromote);
    },
  });
}
