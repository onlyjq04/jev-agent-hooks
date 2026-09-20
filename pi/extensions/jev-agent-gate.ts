// Jev (TypeSafe) check on pi-subagents `Agent` dispatch: agent fit + worker tier
// (luna/sol/astra per ~/.pi/agent/AGENTS.md). The logic is the same gate the Claude Code
// and Codex hooks run, kept in ~/.claude/hooks/ (where install.sh links it) — a plain ESM
// module outside this package, so it is imported by absolute path at call time.
const HOOKS = `${process.env.HOME}/.claude/hooks`;

export default function (pi) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "Agent") return;
    const input = event.input ?? {};
    // resumes continue an existing agent; the dispatch choice was already made
    if (input.resume || !input.subagent_type) return;
    // @ts-ignore -- plain ESM module outside this package
    const { gate } = await import(`${HOOKS}/jev-agent-gate.mjs`);
    const { deny, reason } = await gate({
      host: "pi",
      session: ctx?.sessionManager?.getSessionFile?.() ?? String(process.pid),
      agentName: input.subagent_type,
      model: input.model,
      description: input.description ?? "",
      prompt: input.prompt ?? "",
    });
    if (deny) return { block: true, reason };
  });
}
