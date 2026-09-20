#!/usr/bin/env node
// `jev` CLI for agents: one TypeSafe System One request in, typed answers out.
//   jev '{"state": ..., "questions": {...}}'      or      jev < request.json
// Prints {"answers": ...} as JSON. Usage is logged (question ids and answers, not state)
// to ~/.claude/logs/jev-cli.jsonl so we can see whether agents actually reach for it.
import { readFileSync } from 'node:fs'
import { log, systemOne } from './jev-lib.mjs'

const raw = process.argv[2] ?? readFileSync(0, 'utf8')
let request
try {
  request = JSON.parse(raw)
} catch (e) {
  console.error(`jev: request is not valid JSON: ${e.message}`)
  process.exit(2)
}
if (!process.env.TYPESAFE_API_KEY) {
  console.error('jev: TYPESAFE_API_KEY is not set (start the agent from a fresh login shell)')
  process.exit(2)
}
if (request.state == null || typeof request.questions !== 'object') {
  console.error('jev: request needs "state" and a "questions" map')
  process.exit(2)
}
try {
  const answers = await systemOne(request.questions, request.state, { timeoutMs: 15000 })
  log('jev-cli.jsonl', { cwd: process.cwd(), questions: Object.keys(request.questions), answers })
  console.log(JSON.stringify({ answers }, null, 2))
} catch (e) {
  console.error(`jev: ${e.message}`)
  process.exit(1)
}
