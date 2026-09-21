#!/usr/bin/env node
// SubagentStop gate: a subagent may only stop after delivering a real result —
// its final message is what the orchestrator receives, and nothing else about
// the subagent's run reaches it. Two things are blocked: an empty final
// message, and a progress announcement standing in for a deliverable ("still
// running, will report back"), which reads as a handoff but delivers nothing.
//
// Verified payload shape (captured live, 2026-07-19):
//   { agent_id, agent_type, agent_transcript_path, last_assistant_message,
//     stop_hook_active, ... }
// Block protocol for SubagentStop: {"decision":"block","reason":"..."} —
// the reason is fed back to the subagent and it must continue.

const MIN_REPORT_LEN = 1 // any non-empty text counts as a report

// A progress announcement instead of a result. Only treated as one when the
// message is also SHORT and carries no EVIDENCE — a long report that happens to
// mention a still-running process is a real deliverable.
const PENDING =
  /(还在|仍在|正在|尚在)\s*(跑|运行|执行|处理|进行)|后台(运行|跑|执行)|等待(完成|结果|返回|结束)|稍[后候等]|请稍|完成后.{0,10}(汇报|告知|通知|反馈|回复|同步)|我会.{0,16}(汇报|告知|通知|回复|同步)|still (running|in progress|working|executing)|in progress|will (report|update|follow up|let you know)|check back|once it (finishes|completes|is done)/i
// Signals that the message carries something the orchestrator can act on.
const EVIDENCE =
  /```|[\w./-]+\.\w{1,5}:\d+|^\s*[-*+]\s+\S|session-?id|stopReason|stderr|退出码|exit code/im
const SHORT = 800

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

  const empty = report.length < MIN_REPORT_LEN
  const pending = !empty && report.length < SHORT && PENDING.test(report) && !EVIDENCE.test(report)
  if (!empty && !pending) process.exit(0)

  const reason = empty
    ? `[subagent-return-gate] 禁止空手结束。${who} 的最终消息为空 —— ` +
      `你的最后一条消息会【原样】作为结果返回给 orchestrator（主 agent），这是你唯一的交付物。` +
      `session 不会也不应该由你独自结束；请现在产出最终报告再停止：` +
      `你做了什么、发现了什么、结果数据是什么（结构化、自包含，不要客套话）。`
    : `[subagent-return-gate] 这是进度播报，不是交付。${who} 的最终消息只说了任务还在进行 —— ` +
      `它会【原样】返回给 orchestrator（主 agent），而 orchestrator 看不到你的中间过程、也不会再叫你一次，` +
      `所以「还在跑 / 稍后汇报」到它手里等于空手而归。现在二选一：` +
      `(1) 盯到结果为止——后台任务就轮询到它结束，再转述真实结果；` +
      `(2) 确实拿不到结果就如实报失败：卡在哪、你试过什么、可复查的证据（session-id、退出码、stderr 关键行、已产出的文件路径）。`

  process.stdout.write(JSON.stringify({ decision: 'block', reason }))
})
