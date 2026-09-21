---
name: claude-subagent-model
description: "Route each subagent to haiku, sonnet, opus or fable in regular Claude Code sessions; not for Codex or Kimi."
---

# Subagent model routing

## Applicability

Applies whenever the four aliases resolve to **Claude models** — subscription login, `ANTHROPIC_API_KEY`, a BYOK proxy or third-party coding plan that maps the aliases onto Claude, Bedrock, or Vertex. The tier is the contract; the billing route is irrelevant.

A host that maps the aliases onto non-Claude models (Kimi, GLM, DeepSeek proxies…) owns its own routing, and the tier semantics below don't hold there — leave its model choices to it.

**Rule:** every subagent you spawn — the `Agent` tool, or `agent()` in a Workflow script — gets an explicit `model`. Omit it and the subagent inherits the main-loop model, which is the top tier and wrong for most subtasks. An explicit model choice from the user always wins.

Four values, nothing else: **`haiku` | `sonnet` | `opus` | `fable`**.

Use the **aliases**, never a concrete model id. The aliases are the stable contract; which released version each one points at changes over time (Opus 4.8 → Opus 5 → …) and is resolved at spawn time. A BYOK host resolves them through its own mapping — one more reason the alias, not an id, is what you write. Never paste a resolved id back into this file — a pasted snapshot goes stale silently, an alias never does.

| `model:` | Tier | Cost |
|---|---|---|
| `haiku` | small | cheapest |
| `sonnet` | mid | — |
| `opus` | frontier | — |
| `fable` | frontier+ | most expensive, materially above `opus` |

## The deciding question

**Does this subagent need judgment, or only mechanics?**

| Answer | Model |
|---|---|
| **Pure mechanics** — the answer exists (locate / extract / reshape), or the steps are fully scripted (batch rename, apply a given diff, run commands and report) | `haiku` |
| **Repeated local judgment under a pattern you supplied** — path, pattern and pass/fail check all come from the orchestrator; what is left is applying the pattern N times with per-instance adaptation | `sonnet` |
| **Judgment that ends in a change, or a routine verdict** — implement to a spec, write tests, fix a bug, refactor, day-to-day code review, root-cause diagnosis | `opus` |
| **A hard call, answered as judgment rather than code** — architecture and technology tradeoffs, cross-system impact assessment, adversarial review of a conclusion, the final judge or synthesis stage, or a question `opus` already failed to settle | `fable` |

`fable` runs as an **oracle**, not a builder: give it the question, the context, the constraints and what was already tried; it comes back with a recommendation and the reasoning behind it. Don't authorize it to edit files — when the answer has to become code, hand its recommendation to `opus`. Run length is **not** a `fable` criterion: an unattended multi-hour execution is still `opus`, because hours don't buy depth.

### `sonnet`: where the mid tier fits

Sonnet's cost problem is not its price per token, it is how many tokens it spends when nobody told it when to stop. Given an open-ended task it re-explores, over-produces, and comes back needing rework. It is at its best where **you** have already removed the open-endedness:

1. **The path is given, not discovered.** You name the files and symbols to touch and point at an existing example to follow.
2. **Done is machine-checkable.** One command settles it: a targeted test, `tsc`, lint, a shape check on the diff.
3. **Volume is why you delegated.** You are paying for repetition, not for thinking.

When one of those does not hold, that is the signal to move: no given path means it needs discovery (`haiku` if the answer already exists, `opus` if it does not); a failure that would be silent means `opus`; judgment all along means `opus`.

Against `haiku`: haiku when the transform is deterministic — the same edit everywhere. `sonnet` when every instance needs its own small decision (different assertions per test, a different signature per call site) inside the one fixed pattern.

Two habits worth keeping:

- **Watch the effort.** `sonnet` at `high`/`xhigh` is the worst cell in the whole table: frontier-scale token volume bought with mid-tier judgment. Give a workflow stage an explicit `low` or `medium` when the work is bounded.
- **One shot.** When the check fails, re-run the stage on `opus` rather than retrying on `sonnet`. The retry spiral is where the tokens actually go.

When unsure between `haiku` and `opus`, pick `opus` — a redo costs more than the tier difference. When unsure between `sonnet` and `opus`, pick `opus`: the doubt itself means the path or the repetition is shakier than it looked. When unsure between `opus` and `fable`, start on `opus`; escalate when it comes back undecided, circles the same ground twice, or the call turns out to be a tradeoff rather than a task.

Examples: `haiku` — greps, "where is X defined", renames, schema extraction, binary pass/fail checks, running a named command and summarizing output. `opus` — implementing a feature, tests against a contract, a bug fix even when file + symptom are named, day-to-day code review, verifying a correctness/security claim, carrying out a migration someone already chose. `sonnet` — porting a pattern across 20 call sites you listed, table-driven tests for a contract you specified with an example test to copy, reshaping a large fixture set behind a schema check, drafting per-module docs from code you already read; never "why is this flaky", "find where the state gets lost", a review verdict, or any "figure out how X works". `fable` — "which of these three migration strategies survives a rolling release", "is this root-cause conclusion actually supported by the evidence", picking between two architectures, the final judge over several reviewers' findings, the question opus has now circled twice; if it refuses security-adjacent work, re-run on `opus`.

A subtask that fits two rungs takes the rung it was *named* by: "find the callers" is `haiku` even inside a hard refactor.

## Calibration

In a healthy fan-out, discovery and transform stages are `haiku`; execution, review and root-cause stages are `opus`; a `sonnet` stage, when there is one, sits between them — the pattern was decided upstream and a command checks it downstream; a `fable` stage appears at most once, where the run has to decide something rather than produce something. If a `haiku` stage starts needing decisions, it was mis-tiered — escalate to `opus`, don't retry on `haiku`.

## Effort

Effort is set per tier, not per whim. Omitted = inherit the session effort (`high`).

| Work | model | effort |
|---|---|---|
| Pure mechanics | `haiku` | `low` |
| Bounded volume under a supplied pattern | `sonnet` | `low`–`medium` |
| Execution that needs judgment | `opus` | inherit |
| Review, root cause, adversarial verify, final judge | `opus` | `xhigh` |
| Hard call answered as an oracle | `fable` | `xhigh` — it is one deep answer, not a long run; `max` only when `xhigh` came back undecided |

- **Workflow**: pass `effort` in `agent()` opts, as a literal (`'low'|'medium'|'high'|'xhigh'|'max'`).
- **Agent tool**: it has no effort parameter; effort comes from the agent definition. Pick a preset `subagent_type` and pass its matching `model` (the gate enforces the pair):
  - `mech` → `model: 'haiku'`, effort `low`
  - `bulk` → `model: 'sonnet'`, effort `medium` — the preset that caps the effort, so prefer it when the volume is bounded
  - `deep` → `model: 'opus'`, effort `xhigh`
  - `oracle` → `model: 'fable'`, effort `xhigh`
  - anything else (general-purpose, Explore, specialists) inherits the session effort.

## In workflows

Assign per stage; mix tiers freely in one script. The model (and `effort`, when set) must be a **literal** in the `agent()` opts — the gate cannot read a computed value.

```js
// cheap fan-out — the answer exists, go find it
const found = await parallel(items.map(f => () =>
  agent(scanPrompt(f), { label: `scan:${f}`, model: 'haiku', effort: 'low', schema: HIT })))
// bounded volume: pattern given, `tsc` decides done — label carries the marker
const ported = await parallel(sites.map(s => () =>
  agent(portBrief(s, example), { label: `port ${s} to the listed pattern`, model: 'sonnet', effort: 'medium' })))
// execute the plan — needs judgment
const built = await parallel(found.map(r => () =>
  agent(buildBrief(r), { label: `build:${r.name}`, model: 'opus' })))
// decide whether it's right
const verdict = await agent(verifyBrief(built), { label: 'verify', model: 'opus', effort: 'xhigh' })
```

## Enforcement

`~/.claude/hooks/subagent-model-gate.mjs` (PreToolUse on `Agent|Workflow`, registered in `~/.claude/settings.json`) denies: a missing `model`; a value outside the four; a non-literal model in a workflow script; a preset agent (`mech`/`bulk`/`deep`/`oracle`) with a mismatched model; a non-literal or invalid workflow `effort`. `sonnet` carries no extra admission test — it routes like any other tier. It returns the rubric so you can reassign and retry. Read the reason and fix the assignment; don't retry verbatim.

It decides applicability from three signals, first match wins:

1. `CLAUDE_SUBAGENT_MODEL_GATE` — `on`/`1` forces enforcement, `off`/`0` forces pass-through. Set this in the host's settings when the heuristic below reads the session wrong.
2. Model-override env — `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`. Every present value naming a non-Claude model means the host routes elsewhere: pass through.
3. Otherwise enforce — an alias-passing host is assumed to be serving Claude, so BYOK and API-key sessions get the policy that subscription sessions get.

**Related hook:** `~/.claude/hooks/subagent-return-gate.mjs` (SubagentStop, registered in `~/.claude/settings.json`) blocks a subagent from stopping with an empty final message — that message is the deliverable returned to the orchestrator. When prompting subagents, tell them their final text IS the result.
