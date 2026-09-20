#!/usr/bin/env node
// Jev (TypeSafe) check on subagent dispatch, shared by three hosts:
//   Claude Code  PreToolUse `Agent`        — `node jev-agent-gate.mjs`
//   Codex        PreToolUse `Agent` alias  — `node jev-agent-gate.mjs --host codex`
//   pi           tool_call extension       — imports `gate` from this file
// Each host only checks what its own routing policy leaves to the model:
//   Claude: agent fit + haiku/sonnet/opus/fable tier (claude-subagent-model policy)
//   Codex:  agent fit only (~/.codex/AGENTS.md pins model/effort per role TOML)
//   pi:     agent fit + worker tier luna/sol/astra (~/.pi/agent/AGENTS.md)
// Fails open on every error. Denies at most once per (session, agent, tier) so a
// wrong Jev call can never trap the main loop.
// JEV_AGENT_GATE=off disables; =shadow logs without denying.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { frontmatter, frontmatterValue, log as logTo, systemOne } from './jev-lib.mjs'

const HOME = homedir()
const FIT_MIN = 0.2
const TIER_MIN_CONFIDENCE = 0.5
const TIER_REQUESTED_MAX = 0.15

const CLAUDE_BUILTIN = {
  'general-purpose':
    'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.',
  Explore:
    'Read-only search agent for broad fan-out searches across many files; locates code and returns conclusions. Does not review or audit.',
  Plan: 'Software architect agent for designing implementation plans; read-only, returns step-by-step plans.',
}

const CLAUDE_TIERS = {
  haiku:
    'Purely mechanical: the answer already exists and the subagent only locates, searches, extracts, or reshapes it; or it follows fully scripted steps (batch rename, run commands, apply a given diff) with no judgment.',
  sonnet:
    'Rarely appropriate: only when the delegator explicitly states a reason why neither a mechanical haiku task nor a judgment-requiring opus task fits.',
  opus: 'Any work that needs judgment: implementing to a spec, writing tests, fixing bugs, refactoring, code review, root-cause diagnosis, architecture, adversarial verification, judging or synthesis.',
  fable: 'Long-running, unattended, autonomous work across many steps without supervision.',
}

// ~/.pi/agent/AGENTS.md "Worker scope"
const PI_WORKER_TIERS = {
  luna: 'A clear, mechanical implementation task: fully specified, pattern known, little reasoning required.',
  sol: 'A normal implementation task that needs ordinary reasoning within an approved direction.',
  astra:
    'A hard implementation task: interacting constraints, large refactors, or genuinely complicated changes where a stronger model changes the outcome.',
}

const HOSTS = {
  claude: {
    agentDirs: () => [join(HOME, '.claude/agents'), join(process.cwd(), '.claude/agents'), ...pluginAgentDirs()],
    builtin: CLAUDE_BUILTIN,
    tiers: (agent, model) => (model ? { criteria: CLAUDE_TIERS, requested: model } : null),
  },
  codex: {
    agentDirs: () => [join(HOME, '.codex/agents'), join(process.cwd(), '.codex/agents')],
    builtin: {},
    tiers: () => null,
  },
  pi: {
    agentDirs: () => [join(HOME, '.pi/agent/agents'), join(process.cwd(), '.pi/agents')],
    builtin: {},
    tiers: (agent, model) => {
      const requested = agent === 'worker' && model?.match(/luna|sol|astra/)?.[0]
      return requested ? { criteria: PI_WORKER_TIERS, requested } : null
    },
  },
}

function askJev({ apiKey, task, agent, tiers }) {
  const questions = {}
  if (agent.description) {
    questions.fit = {
      type: 'noul',
      instructions: 'Is the agent described in `agent` suited to perform `task`?',
      criteria: {
        true: "The task falls within the agent's stated specialty or it is a general agent capable of the task",
        false: "The task is outside the agent's specialty or the agent lacks the capability it needs (for example a read-only agent asked to edit)",
      },
    }
  }
  if (tiers) {
    questions.tier = {
      type: 'choice',
      instructions:
        'Which model tier does the subagent need for `task`? Decide by how much the subagent must figure out on its own versus what the delegator already decided in the prompt.',
      criteria: tiers.criteria,
    }
  }
  if (Object.keys(questions).length === 0) return {}
  return systemOne(questions, { task: { ...task, prompt: task.prompt.slice(0, 8000) }, agent }, { apiKey })
}

// Returns { deny, reason, answers }. Never throws for Jev/network failures.
export async function gate({ host, session, agentName, model, description, prompt }) {
  const mode = (process.env.JEV_AGENT_GATE || 'enforce').toLowerCase()
  const apiKey = process.env.TYPESAFE_API_KEY
  if (mode === 'off' || !apiKey) return { deny: false }
  const policy = HOSTS[host]
  const agent = { name: agentName, description: describeAgent(policy, agentName) }
  const tiers = policy.tiers(agentName, model)
  let answers
  try {
    answers = await askJev({ apiKey, task: { description, prompt }, agent, tiers })
  } catch (e) {
    log({ host, session, agentName, model, description, error: String(e) })
    return { deny: false }
  }
  const problems = []
  if (answers.fit && answers.fit.noul < FIT_MIN) {
    problems.push(`子代理 "${agentName}" 不适合这个任务（Jev fit=${answers.fit.noul.toFixed(2)}）。请换一个更对口的子代理。`)
  }
  const t = answers.tier
  const pRequested = t?.probabilities[tiers.requested] ?? 0
  if (t && t.choice !== tiers.requested && t.confidence >= TIER_MIN_CONFIDENCE && pRequested < TIER_REQUESTED_MAX) {
    problems.push(
      `档位 "${tiers.requested}" 与任务性质不符，Jev 建议 "${t.choice}"（confidence=${t.confidence.toFixed(2)}，` +
        `P(${tiers.requested})=${pRequested.toFixed(2)}）。判据：${tiers.criteria[t.choice]}`
    )
  }
  const deny =
    problems.length > 0 && mode === 'enforce' && !alreadyDenied(`${host}:${session}:${agentName}:${tiers?.requested}`)
  log({ host, session, agentName, model, description, answers, problems, deny })
  if (!deny) return { deny: false, answers }
  return {
    deny: true,
    answers,
    reason:
      `[jev-agent-gate] TypeSafe Jev 对这次子代理派发有异议：\n` +
      problems.map((p) => `  - ${p}`).join('\n') +
      `\n如果你确认原选择正确，原样重新提交一次即可放行（同一会话同一组合只拦一次）。`,
  }
}

const agentIndexes = new Map()
function describeAgent(policy, name) {
  if (policy.builtin[name]) return policy.builtin[name]
  if (!agentIndexes.has(policy)) agentIndexes.set(policy, buildAgentIndex(policy.agentDirs()))
  return agentIndexes.get(policy).get(name)
}

function buildAgentIndex(dirs) {
  const index = new Map()
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), 'utf8')
      let name, desc
      if (f.endsWith('.md')) {
        const fm = frontmatter(text)
        if (!fm || /^enabled:\s*false/m.test(fm)) continue
        name = frontmatterValue(fm, 'name') ?? f.slice(0, -3)
        desc = frontmatterValue(fm, 'description')
      } else if (f.endsWith('.toml')) {
        name = text.match(/^name\s*=\s*"(.*)"/m)?.[1] ?? f.slice(0, -5)
        desc = text.match(/^description\s*=\s*"(.*)"/m)?.[1]
      }
      if (name && desc && !index.has(name)) index.set(name, desc.replace(/\s+/g, ' ').slice(0, 1500))
    }
  }
  return index
}

// ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/agents
function pluginAgentDirs() {
  const root = join(HOME, '.claude/plugins/cache')
  const out = []
  const walk = (dir, depth) => {
    if (depth === 3) return out.push(join(dir, 'agents'))
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) walk(join(dir, e.name), depth + 1)
    } catch {}
  }
  walk(root, 0)
  return out
}

function alreadyDenied(key) {
  const file = join(tmpdir(), 'jev-agent-gate-denied.json')
  let seen = {}
  try {
    seen = JSON.parse(readFileSync(file, 'utf8'))
  } catch {}
  if (seen[key]) return true
  seen[key] = Date.now()
  writeFileSync(file, JSON.stringify(seen))
  return false
}

function log(entry) {
  logTo('jev-agent-gate.jsonl', entry)
}

// Command-hook entry for Claude Code and Codex (same PreToolUse stdin/stdout protocol).
async function main() {
  const host = process.argv.includes('--host') ? process.argv[process.argv.indexOf('--host') + 1] : 'claude'
  if (host === 'claude' && !process.env.CLAUDECODE) return
  let raw = ''
  for await (const d of process.stdin) raw += d
  const payload = JSON.parse(raw)
  const input = payload.tool_input || {}
  let call
  if (host === 'codex') {
    // spawn_agent's message arrives encrypted in some Codex builds; Jev cannot judge ciphertext
    if (typeof input.message !== 'string' || input.message.startsWith('gAAAAA')) return
    call = { agentName: input.agent_type || 'default', model: input.model, description: input.task_name || '', prompt: input.message }
  } else {
    const agentName = input.subagent_type || 'general-purpose'
    // fork inherits parent model and context; model is not a real choice there
    if (payload.tool_name !== 'Agent' || agentName === 'fork' || !input.model) return
    call = { agentName, model: input.model, description: input.description || '', prompt: input.prompt || '' }
  }
  const { deny, reason } = await gate({ host, session: payload.session_id, ...call })
  if (!deny) return
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    })
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {}) // fail open
}
