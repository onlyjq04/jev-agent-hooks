#!/usr/bin/env node
// Per-turn skill suggestion following TypeSafe's skill-suggestion cookbook
// (docs.typesafe.ai/cookbooks/skill_suggestion), shared by three hosts:
//   Claude Code  UserPromptSubmit — `node jev-skill-suggest.mjs`
//   Codex        UserPromptSubmit — `node jev-skill-suggest.mjs --host codex`
//   pi           before_agent_start extension — imports `suggest` / `suggestionBlock`
//   request 1: Choice over the whole roster + three "does this want an action" nouls
//   request 2: Choice over the top 3 with longer text + one "fits" noul per candidate
// The injected wording is the cookbook's measured wording: the suggestion is explicitly ignorable.
// Fails open (no output) on any error. JEV_SKILL_SUGGEST=off disables; =shadow logs only.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { frontmatter, frontmatterValue, log, systemOne } from './jev-lib.mjs'

const HOME = homedir()
const SHORTLIST = 3
const EXCERPT_CHARS = 700
const GATE_THRESHOLD = 0.3
// cookbook uses 0.3; on 34 of this user's turns 0.3 suggested on 15/16 skill-less turns,
// 0.7 kept the agreeing picks and cut that to 3. The gate barely separates in a coding
// agent (nearly every request "acts on the user's files"), so this threshold does the work.
const FITS_THRESHOLD = 0.7

const GATE_QUESTIONS = {
  acts_on_user_system:
    "Is the assistant being asked to act on the user's files, accounts, devices, or online services, rather than only to explain or advise?",
  would_follow_documented_procedure:
    'Would a careful expert answering this consult a specific documented procedure or set of commands, rather than answering from general understanding?',
  prose_suffices:
    "Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts?",
}
const INVERTED = new Set(['prose_suffices'])

// Map name -> { description, body }. Claude: user + project + enabled plugins (plugin:skill).
export function claudeRoster(cwd = process.cwd()) {
  const settings = readJson(join(HOME, '.claude/settings.json')) ?? {}
  const overrides = settings.skillOverrides ?? {}
  const installed = readJson(join(HOME, '.claude/plugins/installed_plugins.json'))?.plugins ?? {}
  const roster = new Map()
  addSkillDirs(roster, [join(HOME, '.claude/skills'), join(cwd, '.claude/skills')])
  for (const [id, on] of Object.entries(settings.enabledPlugins ?? {})) {
    const path = installed[id]?.[0]?.installPath
    if (on === true && path) addSkillDirs(roster, [join(path, 'skills')], `${id.split('@')[0]}:`)
  }
  for (const [name, mode] of Object.entries(overrides)) if (mode === 'off' || mode === 'user-invocable-only') roster.delete(name)
  return roster
}

// Codex: ~/.agents/skills, ~/.codex/skills (+ bundled .system), and .agents/skills from cwd up to the repo root.
export function codexRoster(cwd = process.cwd()) {
  const dirs = [join(HOME, '.agents/skills'), join(HOME, '.codex/skills'), join(HOME, '.codex/skills/.system')]
  for (let d = cwd; ; d = dirname(d)) {
    dirs.push(join(d, '.agents/skills'))
    if (existsSync(join(d, '.git')) || dirname(d) === d) break
  }
  const roster = new Map()
  addSkillDirs(roster, dirs)
  return roster
}

// pi hands over its already-resolved skills (settings filters and packages applied).
export function piRoster(skills) {
  const roster = new Map()
  for (const s of skills ?? []) {
    if (s.disableModelInvocation || roster.has(s.name)) continue
    let body = ''
    try {
      const text = readFileSync(s.filePath, 'utf8')
      body = text.slice(text.indexOf('\n---', 3) + 4).trim()
    } catch {}
    roster.set(s.name, { description: s.description, body })
  }
  return roster
}

function addSkillDirs(roster, dirs, prefix = '') {
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      const file = join(dir, entry, 'SKILL.md')
      if (!existsSync(file)) continue
      const text = readFileSync(file, 'utf8')
      const fm = frontmatter(text)
      if (!fm || frontmatterValue(fm, 'disable-model-invocation') === 'true') continue
      const name = prefix + (frontmatterValue(fm, 'name') ?? entry)
      const description = frontmatterValue(fm, 'description')
      if (!description || roster.has(name)) continue
      roster.set(name, { description, body: text.slice(text.indexOf('\n---', 3) + 4).trim() })
    }
  }
}

export async function suggest(request, recentContext, roster) {
  if (roster.size === 0) return { pick: null }
  const state = { request, recent_context: recentContext }
  const wide = { which: { type: 'choice', instructions: "Which of these skills, if any, is the right one to load to help with the user's latest request?", criteria: {} } }
  for (const [name, s] of roster) wide.which.criteria[name] = s.description.slice(0, 250)
  for (const [key, text] of Object.entries(GATE_QUESTIONS)) wide[`gate::${key}`] = { type: 'noul', instructions: text }
  const a1 = await systemOne(wide, state)
  const gateValues = Object.keys(GATE_QUESTIONS).map((k) => (INVERTED.has(k) ? 1 - a1[`gate::${k}`].noul : a1[`gate::${k}`].noul))
  const gate = gateValues.reduce((x, y) => x + y, 0) / gateValues.length
  const shortlist = Object.entries(a1.which.probabilities)
    .sort((x, y) => y[1] - x[1])
    .slice(0, SHORTLIST)
    .map(([name]) => name)
  if (gate < GATE_THRESHOLD) return { pick: null, gate, shortlist }

  const narrow = {
    which: {
      type: 'choice',
      instructions: "Exactly one of these skills is the right one to load for the user's latest request. Which one? Read what each actually does, not just its name.",
      criteria: Object.fromEntries(shortlist.map((n) => [n, `${roster.get(n).description} — ${roster.get(n).body.slice(0, EXCERPT_CHARS)}`])),
    },
  }
  for (const n of shortlist) {
    narrow[`fits::${n}`] = {
      type: 'noul',
      instructions: `Does the skill '${n}' do the specific thing the user's request asks for? It is described as: ${roster.get(n).description}`,
    }
  }
  const a2 = await systemOne(narrow, state)
  const fits = Object.fromEntries(shortlist.map((n) => [n, a2[`fits::${n}`].noul]))
  const pick = Math.max(...Object.values(fits)) < FITS_THRESHOLD ? null : a2.which.choice
  return { pick, gate, shortlist, fits }
}

// Unlike the cookbook, no "nothing relevant" line: Claude Code's built-in skills (update-config,
// loop, …) have no SKILL.md, are missing from the roster, and must not be talked out of.
export function suggestionBlock(pick) {
  return `<skill_relevance source="jev">\nRelevant to the current request: ${pick}. Ignore this if it does not fit what the user actually asked for.\n</skill_relevance>`
}

// Last assistant text before this prompt: follow-ups like "ok, go ahead" carry no meaning alone.
// Reads Claude Code transcripts and Codex rollouts (whose format Codex documents as unstable;
// an unknown shape just yields no context).
function recentAssistantText(transcriptPath) {
  try {
    const lines = readFileSync(transcriptPath, 'utf8').trimEnd().split('\n')
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 400; i--) {
      const row = JSON.parse(lines[i])
      const msg =
        row.type === 'assistant' ? row.message : row.payload?.type === 'message' && row.payload.role === 'assistant' ? row.payload : null
      const text = (msg?.content ?? []).filter((c) => c.type === 'text' || c.type === 'output_text').map((c) => c.text).join('\n')
      if (text) return text.slice(-1500)
    }
  } catch {}
  return ''
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

// Command-hook entry for Claude Code and Codex (same UserPromptSubmit stdin/stdout protocol).
async function main() {
  const host = process.argv.includes('--host') ? process.argv[process.argv.indexOf('--host') + 1] : 'claude'
  const mode = (process.env.JEV_SKILL_SUGGEST || 'on').toLowerCase()
  if (mode === 'off' || !process.env.TYPESAFE_API_KEY) return
  if (host === 'claude' && !process.env.CLAUDECODE) return
  let raw = ''
  for await (const d of process.stdin) raw += d
  const payload = JSON.parse(raw)
  const prompt = (payload.prompt ?? '').trim()
  // slash commands (Claude) and $skill mentions (Codex) already name their skill
  if (!prompt || prompt.startsWith('/') || prompt.startsWith('$')) return
  const roster = host === 'codex' ? codexRoster(payload.cwd) : claudeRoster(payload.cwd)
  const started = Date.now()
  const result = await suggest(prompt.slice(0, 6000), recentAssistantText(payload.transcript_path), roster)
  log('jev-skill-suggest.jsonl', { host, session: payload.session_id, prompt: prompt.slice(0, 200), ms: Date.now() - started, mode, ...result })
  if (mode === 'shadow' || !result.pick) return
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: suggestionBlock(result.pick) } }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {}) // fail open
}
