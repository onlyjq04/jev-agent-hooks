#!/usr/bin/env node
// SubagentStop gate: a subagent may only
// stop after delivering a non-empty final message — that message is what the
// orchestrator receives as the subagent's result. Ending with an empty final
// message is blocked and the subagent is told to report back properly.
//
// Verified payload shape (captured live, 2026-07-19):
//   { agent_id, agent_type, agent_transcript_path, last_assistant_message,
//     stop_hook_active, ... }
// Block protocol for SubagentStop: {"decision":"block","reason":"..."} —
// the reason is fed back to the subagent and it must continue.

const MIN_REPORT_LEN = 1 // any non-empty text counts as a report

let raw = ''
process.stdin.on('data', (d) => (raw += d))
process.stdin.on('end', () => {
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  // Loop guard: if we already blocked this stop once, let it through.
  if (payload.stop_hook_active === true) process.exit(0)

  const report = (payload.last_assistant_message ?? '').trim()
  const who = `${payload.agent_type || 'subagent'}(${payload.agent_id || '?'})`

  if (report.length >= MIN_REPORT_LEN) process.exit(0)

  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        `[subagent-return-gate] 禁止空手结束。${who} 的最终消息为空 —— ` +
        `你的最后一条消息会【原样】作为结果返回给 orchestrator（主 agent），这是你唯一的交付物。` +
        `session 不会也不应该由你独自结束；请现在产出最终报告再停止：` +
        `你做了什么、发现了什么、结果数据是什么（结构化、自包含，不要客套话）。`,
    })
  )
})
