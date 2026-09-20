// Per-turn skill suggestion from TypeSafe Jev, appended to this turn's system prompt
// (not persisted to the session). Logic lives in the shared hook used by Claude Code and Codex.
// The shared logic lives in ~/.claude/hooks/ (where install.sh links it); plain ESM
// modules outside this package, so they are imported by absolute path at call time.
const HOOKS = `${process.env.HOME}/.claude/hooks`;

function lastAssistantText(ctx) {
  const branch = ctx?.sessionManager?.getBranch?.() ?? [];
  for (let i = branch.length - 1; i >= 0; i--) {
    const m = branch[i]?.type === "message" ? branch[i].message : null;
    if (m?.role !== "assistant") continue;
    const text = (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    if (text) return text.slice(-1500);
  }
  return "";
}

export default function (pi) {
  pi.on("before_agent_start", async (event, ctx) => {
    const mode = (process.env.JEV_SKILL_SUGGEST || "on").toLowerCase();
    const prompt = (event.prompt ?? "").trim();
    if (mode === "off" || !process.env.TYPESAFE_API_KEY || !prompt || prompt.startsWith("/")) return;
    try {
      // @ts-ignore -- plain ESM modules outside this package
      const { piRoster, suggest, suggestionBlock } = await import(`${HOOKS}/jev-skill-suggest.mjs`);
      // @ts-ignore
      const { log } = await import(`${HOOKS}/jev-lib.mjs`);
      const started = Date.now();
      const result = await suggest(prompt.slice(0, 6000), lastAssistantText(ctx), piRoster(event.systemPromptOptions?.skills));
      log("jev-skill-suggest.jsonl", { host: "pi", session: ctx?.sessionManager?.getSessionId?.(), prompt: prompt.slice(0, 200), ms: Date.now() - started, mode, ...result });
      if (mode === "shadow" || !result.pick) return;
      return { systemPrompt: `${event.systemPrompt}\n\n${suggestionBlock(result.pick)}` };
    } catch (e) {
      // @ts-ignore
      const { log } = await import(`${HOOKS}/jev-lib.mjs`);
      log("jev-skill-suggest.jsonl", { host: "pi", error: String(e) });
      return; // fail open
    }
  });
}
