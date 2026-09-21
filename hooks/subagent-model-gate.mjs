#!/usr/bin/env node
// PreToolUse gate for sessions whose model aliases resolve to Claude models
// (subscription, API key, BYOK proxy, Bedrock, Vertex alike): enforce the
// claude-subagent-model policy on Agent / Workflow calls.
//   - every subagent must get an EXPLICIT model (omitting = inheriting the
//     main-loop model, which the policy forbids)
//   - allowed values: haiku | sonnet | opus | fable  (anything else: deny)
//   - sonnet carries no extra admission test; it routes like any other tier
//   - Workflow scripts: every agent(...) call site must pass a literal
//     model: 'haiku'|'sonnet'|'opus'|'fable' in its opts
// Only aliases are accepted — never a concrete model id (claude-opus-5 etc.),
// so this gate does not need updating when a new release ships.
// Exit 0 with no output = allow. Deny = JSON with hookSpecificOutput on stdout.

import { readFileSync } from 'node:fs'

const ALLOWED = ['haiku', 'sonnet', 'opus', 'fable']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
// 预设 effort 的 agent 必须配对应 model（Agent 的 model 参数会覆盖 frontmatter）
const PRESET_MODEL = { mech: 'haiku', bulk: 'sonnet', deep: 'opus', oracle: 'fable' }

// Applicability, first match wins:
//   1. CLAUDE_SUBAGENT_MODEL_GATE=on|1 / off|0 — explicit override.
//   2. Model-override env: every present value naming a non-Claude model means
//      the host routes the aliases elsewhere (Kimi, GLM, DeepSeek …) and owns
//      its own routing — pass through.
//   3. Otherwise enforce. An alias-passing host is assumed to serve Claude, so
//      BYOK / API-key / Bedrock / Vertex sessions get the same policy as a
//      subscription session.
const MODEL_ENV = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
]

if (!isApplicable()) process.exit(0)

function isApplicable() {
  if (!process.env.CLAUDECODE) return false
  const override = (process.env.CLAUDE_SUBAGENT_MODEL_GATE || '').trim().toLowerCase()
  if (/^(on|1|true)$/.test(override)) return true
  if (/^(off|0|false)$/.test(override)) return false
  const declared = MODEL_ENV.map((k) => process.env[k]).filter((v) => v && v.trim())
  if (declared.length > 0 && !declared.some((v) => /claude/i.test(v))) return false
  return true
}

let raw = ''
process.stdin.on('data', (d) => (raw += d))
process.stdin.on('end', () => {
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0) // unparseable input — not ours to judge
  }
  const problems = check(payload)
  if (problems.length === 0) process.exit(0)

  const reason =
    `[subagent-model-gate] 模型分配不合规，已阻止。请按 claude-subagent-model 策略重新分配后重试：\n` +
    problems.map((p) => `  - ${p}`).join('\n') +
    `\n规则：每个子代理必须【显式】指定 model（省略=继承主循环模型，禁止）。判据是「这个子代理` +
    `需要自己想清楚什么、而你没有替它想好」：\n` +
    `  - 纯机械：答案已存在只需定位/改形，或步骤已写死的批量改写/跑命令 → haiku\n` +
    `  - 需要判断：按方案实现、写测试、修 bug、review、根因、架构、对抗式验证、judge → opus\n` +
    `  - 有界批量（路径已给定 + 有一条命令能判完成 + 派的是重复量）→ sonnet\n` +
    `  - 高难度决策/深度判断，且产出是结论不是代码（架构取舍、对抗式复核、最终裁决、opus 绕不出来的问题）→ fable\n` +
    `Workflow 脚本中 agent() 的 model 必须是字面量。只用别名，禁止具体模型 id。`
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  )
})

function check(payload) {
  const tool = payload.tool_name
  const input = payload.tool_input || {}
  if (tool === 'Agent') return checkAgent(input)
  if (tool === 'Workflow') return checkWorkflow(input)
  return []
}

function checkAgent(input) {
  const m = input.model
  if (m == null) {
    return [
      `Agent(${input.subagent_type || 'general-purpose'}) 未指定 model —— 会继承主循环模型。` +
        `请按判据显式选择 haiku/sonnet/opus/fable。`,
    ]
  }
  if (!ALLOWED.includes(m)) {
    return [`Agent 的 model: "${m}" 不在允许范围（haiku|sonnet|opus|fable）；具体模型 id 也不接受，只用别名。`]
  }
  const preset = PRESET_MODEL[input.subagent_type]
  if (preset && m !== preset) return [`Agent(${input.subagent_type}) 必须配 model: "${preset}"，当前是 "${m}"。`]
  return []
}

function checkWorkflow(input) {
  const script = getScript(input)
  if (script == null) return [] // named workflow / unreadable scriptPath — nothing to inspect
  const problems = []
  for (const call of extractAgentCalls(script)) {
    const model = readProp(call, 'model')
    const label = readProp(call, 'label')?.literal
    const where = label ? `agent() label="${label}"` : '一处 agent() 调用'
    if (!model) {
      problems.push(`Workflow 中 ${where} 未指定 model —— 会继承主循环模型，请显式分配。`)
    } else if (!model.literal) {
      problems.push(
        `Workflow 中 ${where} 的 model 不是字面量 —— 门控只接受字面量 'haiku'|'sonnet'|'opus'|'fable'。`
      )
    } else if (!ALLOWED.includes(model.literal)) {
      problems.push(`Workflow 中 ${where} 的 model: "${model.literal}" 不在允许范围（haiku|sonnet|opus|fable）。`)
    }
    const effort = readProp(call, 'effort')
    if (effort && !EFFORTS.includes(effort.literal)) {
      problems.push(`Workflow 中 ${where} 的 effort 必须是字面量 ${EFFORTS.map((e) => `'${e}'`).join('|')}，或省略以继承会话 effort。`)
    }
  }
  return problems
}

function getScript(input) {
  if (typeof input.script === 'string') return input.script
  if (typeof input.scriptPath === 'string') {
    try {
      return readFileSync(input.scriptPath, 'utf8')
    } catch {
      return null
    }
  }
  return null
}

// --- tiny JS scanner: tracks code/string/template/comment state so that
// `agent(` inside strings or comments is ignored ---

const isId = (c) => /[\w$]/.test(c || '')

// Walk `src` starting at index `from` (in code state) until `stop(src, i)`
// returns true or the string ends. Returns the stop index. Handles strings,
// template literals, and comments.
function walkCode(src, from, stop) {
  let i = from
  let state = 'code'
  let quote = null
  while (i < src.length) {
    const c = src[i]
    if (state === 'line') {
      if (c === '\n') state = 'code'
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && src[i + 1] === '/') {
        state = 'code'
        i += 2
      } else i++
      continue
    }
    if (state === 'str') {
      if (c === '\\') i += 2
      else {
        if (c === quote) state = 'code'
        i++
      }
      continue
    }
    // code state
    if (stop(src, i)) return i
    if (c === '/' && src[i + 1] === '/') {
      state = 'line'
      i += 2
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      state = 'block'
      i += 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      state = 'str'
      quote = c
      i++
      continue
    }
    i++
  }
  return i
}

// Extract the full text of each `agent(...)` call that appears in code state.
function extractAgentCalls(script) {
  const calls = []
  let from = 0
  while (from < script.length) {
    const hit = walkCode(script, from, (s, i) => {
      if (!s.startsWith('agent', i)) return false
      if (isId(s[i - 1]) || isId(s[i + 5])) return false
      let j = i + 5
      while (/\s/.test(s[j] || '')) j++
      return s[j] === '('
    })
    if (hit >= script.length) break
    // find the '(' after the identifier
    let open = hit + 5
    while (/\s/.test(script[open])) open++
    // walk to the matching close paren (depth tracked in code state)
    let depth = 0
    const end = walkCode(script, open, (s, i) => {
      if (s[i] === '(') depth++
      else if (s[i] === ')') {
        depth--
        if (depth === 0) return true
      }
      return false
    })
    calls.push(script.slice(hit, Math.min(end + 1, script.length)))
    from = hit + 5 // continue inside the call to catch nested agent(
  }
  return calls
}

// Read an object-literal-style property from a call's text, in code state.
// Returns { literal: string } for a string-literal value, { literal: null }
// for a non-literal value, or undefined if the property is absent.
function readProp(callText, name) {
  const hit = walkCode(callText, 0, (s, i) => {
    if (!s.startsWith(name, i)) return false
    if (isId(s[i - 1]) || isId(s[i + name.length])) return false
    let j = i + name.length
    while (/\s/.test(s[j] || '')) j++
    return s[j] === ':'
  })
  if (hit >= callText.length) return undefined
  let j = hit + name.length + 1
  while (j < callText.length && /\s|:/.test(callText[j])) j++
  const c = callText[j]
  if (c === "'" || c === '"' || c === '`') {
    let k = j + 1
    let out = ''
    while (k < callText.length && callText[k] !== c) {
      if (callText[k] === '\\') k++
      if (k < callText.length) out += callText[k]
      k++
    }
    return { literal: out }
  }
  return { literal: null }
}
