---
name: claude-subagent-model
description: "Route each subagent to haiku, sonnet, opus or fable in regular Claude Code sessions; not for Codex or Kimi."
---

# Subagent model routing

## Applicability

Applies whenever the four aliases resolve to **Claude models** — subscription login, `ANTHROPIC_API_KEY`, a BYOK proxy or third-party coding plan that maps the aliases onto Claude, Bedrock, or Vertex. The tier is the contract; the billing route is irrelevant.

A host that maps the aliases onto non-Claude models (Kimi, GLM, DeepSeek proxies…) owns its own routing, and the tier semantics below don't hold there — leave its model choices to it.

**Rule:** every subagent you spawn — the `Agent` tool, or `agent()` in a Workflow script — gets an explicit `model`. Omit it and the subagent inherits the main-loop model, which is the top tier and wrong for most subtasks. An explicit model choice from the user always wins.

Four values at the call site, nothing else: **`haiku` | `sonnet` | `opus` | `fable`**. The `Agent` tool's `model` parameter only takes these aliases, so a concrete id cannot go there.

## Versions

Each alias is pinned to a concrete release in `~/.claude/settings.json` → `env`, and that is the only place a model id is written. Prefer the newest release of each family; when one ships, update the pin there and in `config/claude-settings.snippet.json`, and nowhere else.

| `model:` | Pinned to | env var | Tier | Cost |
|---|---|---|---|---|
| `haiku` | `claude-haiku-4-5-20251001` (Haiku 4.5, no 5.x yet) | `ANTHROPIC_DEFAULT_HAIKU_MODEL` | small | cheapest |
| `sonnet` | `claude-sonnet-5-5` (Sonnet 5.5) | `ANTHROPIC_DEFAULT_SONNET_MODEL` | mid | — |
| `opus` | `claude-opus-5-5` (Opus 5.5) | `ANTHROPIC_DEFAULT_OPUS_MODEL` | frontier | — |
| `fable` | `claude-fable-5-1` (Fable 5.1) | `ANTHROPIC_DEFAULT_FABLE_MODEL` | frontier+ | most expensive, materially above `opus` |

The main loop is pinned the same way: `"model": "claude-opus-5-5[1m]"`.

## The deciding question

**Who decides the approach — you, in the prompt, or the subagent?**

| Answer | Model |
|---|---|
| **Pure mechanics** — the answer exists (locate / extract / reshape), or the steps are fully scripted (batch rename, apply a given diff, run commands and report) | `haiku` |
| **The approach is decided; the subagent carries it out** — you can write the task as plain instructions: what to change, what to follow, how to tell it is done. Implement to a spec, tests against a contract, port a pattern, carry out a migration someone already chose, fix a bug whose cause is already known | `sonnet` |
| **The subagent has to work out the approach** — open-ended design, root-cause diagnosis, debugging an unexplained failure, code review verdicts, a refactor that needs a new shape, anything that wants creativity or a wide look at options | `opus` |
| **A hard call, answered as judgment rather than code** — architecture and technology tradeoffs, cross-system impact assessment, adversarial review of a conclusion, the final judge or synthesis stage, or a question `opus` already failed to settle | `fable` |

Sonnet 5.5 follows straightforward instructions well and does real implementation work, so "judgment that ends in a change" no longer means `opus` by itself. What puts work on `opus` is that nobody has decided *how* yet: Opus 5.5 is the tier for creative, wide-ranging thinking.

`fable` runs as an **oracle**, not a builder: give it the question, the context, the constraints and what was already tried; it comes back with a recommendation and the reasoning behind it. Don't authorize it to edit files — when the answer has to become code, hand its recommendation to `opus` (or to `sonnet`, once the recommendation reads as instructions). Run length is **not** a `fable` criterion: an unattended multi-hour execution is still `opus` or `sonnet`, because hours don't buy depth.

### `sonnet` vs `opus`

The test: **can you write the brief as steps?** If the prompt names the files or area, says what the result must look like, and gives a check for done (a test, `tsc`, lint, a diff shape), it is `sonnet`. If writing the brief means saying "figure out why" or "find a good way to", it is `opus`.

- Upstream design settles the approach, and then execution drops to `sonnet`. A plan written by `opus` or `fable` is exactly what turns an `opus` task into a `sonnet` one.
- **One shot on a stuck `sonnet`.** When it comes back with a design question, or the check fails for a reason the brief didn't foresee, re-run on `opus` instead of retrying on `sonnet`: the task turned out to be open after all.
- Against `haiku`: `haiku` when the transform is deterministic, the same edit everywhere. `sonnet` when each instance needs its own small decision, or when the work is real implementation rather than reshaping.

When unsure between `haiku` and `sonnet`, pick `sonnet` — a redo costs more than the tier difference. When unsure between `sonnet` and `opus`, pick `opus`: the doubt usually means the approach is less settled than it looked. When unsure between `opus` and `fable`, start on `opus`; escalate when it comes back undecided, circles the same ground twice, or the call turns out to be a tradeoff rather than a task.

Examples: `haiku` — greps, "where is X defined", renames, schema extraction, binary pass/fail checks, running a named command and summarizing output. `sonnet` — implementing a feature from a written plan, tests for a contract you specified, porting a pattern across the call sites you listed, a bug fix where the cause and the fix are already known, a migration someone already chose, reshaping fixtures behind a schema check, drafting per-module docs from an outline. `opus` — designing a feature from a vague goal, "why is this flaky", "find where the state gets lost", a bug fix where only the symptom is known, day-to-day code review, verifying a correctness/security claim, "figure out how X works", a refactor whose target shape isn't decided. `fable` — "which of these three migration strategies survives a rolling release", "is this root-cause conclusion actually supported by the evidence", picking between two architectures, the final judge over several reviewers' findings, the question opus has now circled twice; if it refuses security-adjacent work, re-run on `opus`.

A subtask that fits two rungs takes the rung it was *named* by: "find the callers" is `haiku` even inside a hard refactor.

## Calibration

In a healthy fan-out, discovery and transform stages are `haiku`; design, root-cause and review stages are `opus`; execution of a decided plan is `sonnet`; a `fable` stage appears at most once, where the run has to decide something rather than produce something. If a `haiku` stage starts needing decisions, it was mis-tiered — escalate, don't retry on `haiku`. If a `sonnet` stage starts needing design, escalate to `opus`.

## Effort

Effort is set per tier, not per whim. Omitted = inherit the session effort (`high`).

| Work | model | effort |
|---|---|---|
| Pure mechanics | `haiku` | `low` |
| Execution of a decided approach | `sonnet` | `medium`; inherit when the implementation itself is large |
| Open-ended work: design, debugging, creative changes | `opus` | inherit |
| Review, root cause, adversarial verify, final judge | `opus` | `xhigh` |
| Hard call answered as an oracle | `fable` | `xhigh` — it is one deep answer, not a long run; `max` only when `xhigh` came back undecided |

- **Workflow**: pass `effort` in `agent()` opts, as a literal (`'low'|'medium'|'high'|'xhigh'|'max'`).
- **Agent tool**: it has no effort parameter; effort comes from the agent definition. Pick a preset `subagent_type` and pass its matching `model` (the gate enforces the pair):
  - `mech` → `model: 'haiku'`, effort `low`
  - `bulk` → `model: 'sonnet'`, effort `medium` — execution of a brief you already wrote as steps
  - `deep` → `model: 'opus'`, effort `xhigh`
  - `oracle` → `model: 'fable'`, effort `xhigh`
  - anything else (general-purpose, Explore, specialists) inherits the session effort.

## In workflows

Assign per stage; mix tiers freely in one script. The model (and `effort`, when set) must be a **literal** in the `agent()` opts — the gate cannot read a computed value.

```js
// cheap fan-out — the answer exists, go find it
const found = await parallel(items.map(f => () =>
  agent(scanPrompt(f), { label: `scan:${f}`, model: 'haiku', effort: 'low', schema: HIT })))
// work out the approach — open-ended
const plan = await agent(designBrief(found), { label: 'design', model: 'opus' })
// carry out the decided plan — the brief is steps plus a check
const built = await parallel(plan.steps.map(s => () =>
  agent(buildBrief(s), { label: `build:${s.name}`, model: 'sonnet', effort: 'medium' })))
// decide whether it's right
const verdict = await agent(verifyBrief(built), { label: 'verify', model: 'opus', effort: 'xhigh' })
```

## Enforcement

`~/.claude/hooks/subagent-model-gate.mjs` (PreToolUse on `Agent|Workflow`, registered in `~/.claude/settings.json`) denies: a missing `model`; a value outside the four aliases; a non-literal model in a workflow script; a preset agent (`mech`/`bulk`/`deep`/`oracle`) with a mismatched model; a non-literal or invalid workflow `effort`. It returns the rubric so you can reassign and retry. Read the reason and fix the assignment; don't retry verbatim.

It decides applicability from three signals, first match wins:

1. `CLAUDE_SUBAGENT_MODEL_GATE` — `on`/`1` forces enforcement, `off`/`0` forces pass-through. Set this in the host's settings when the heuristic below reads the session wrong.
2. Model-override env — `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`. Every present value naming a non-Claude model means the host routes elsewhere: pass through. The version pins above name Claude models, so they keep the gate on.
3. Otherwise enforce — an alias-passing host is assumed to be serving Claude, so BYOK and API-key sessions get the policy that subscription sessions get.

**Related hook:** `~/.claude/hooks/subagent-return-gate.mjs` (SubagentStop, registered in `~/.claude/settings.json`) blocks a subagent from stopping with an empty final message — that message is the deliverable returned to the orchestrator. When prompting subagents, tell them their final text IS the result.
