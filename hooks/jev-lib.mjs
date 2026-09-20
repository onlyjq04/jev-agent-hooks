// Shared bits for the Jev (TypeSafe) hooks and the `jev` CLI.
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export async function systemOne(questions, state, { apiKey = process.env.TYPESAFE_API_KEY, timeoutMs = 4000 } = {}) {
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`typesafe ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()).answers
}

// Scalar or block (| / >) value of a top-level key; enough for agent/skill frontmatter.
export function frontmatterValue(fm, key) {
  const lines = fm.split('\n')
  const i = lines.findIndex((l) => l.startsWith(`${key}:`))
  if (i < 0) return undefined
  let value = lines[i].slice(key.length + 1).trim()
  if (/^[|>][-+]?$/.test(value)) {
    const body = []
    for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) body.push(lines[j].trim())
    value = body.join(' ')
  }
  return value.replace(/^["']|["']$/g, '') || undefined
}

export function frontmatter(text) {
  return text.match(/^---\n([\s\S]*?)\n---/)?.[1]
}

export function log(file, entry) {
  try {
    mkdirSync(join(homedir(), '.claude/logs'), { recursive: true })
    appendFileSync(join(homedir(), '.claude/logs', file), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
  } catch {}
}
