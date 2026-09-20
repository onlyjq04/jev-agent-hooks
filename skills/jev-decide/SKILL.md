---
name: jev-decide
description: Get a fast, calibrated second judgment from TypeSafe Jev via the local `jev` CLI. Use when narrowing many candidates (search hits, files, log lines, options) to the relevant few, when a user instruction may be ambiguous and you must decide between acting and asking, or before reporting work done to check the evidence (test output, diff) actually supports the claim.
---

# jev-decide

`jev` sends one TypeSafe System One request and prints typed answers with probabilities.
It is ~0.5 s and cheap. It does not reason or write text; it returns judgments your next
step can act on. For the primitives and question-writing rules, the `typesafe-ai` skill
and https://docs.typesafe.ai are the reference.

```bash
jev '{"state": {...}, "questions": {"id": {"type": "noul"|"choice"|"score", "instructions": "...", "criteria": ...}}}'
jev < request.json    # or a quoted heredoc: jev <<'EOF' ... EOF
```

Single-quote the JSON or use a quoted heredoc: instructions reference state paths in
backticks (`` `evidence` ``), which double quotes would hand to the shell.

## When to call it

**1. Rank many candidates.** You have more candidates than you can read closely: grep
hits, files, log lines, tickets, search results. Put the query in `state`, one Choice with
each candidate id as an option (short text as its criteria), or one Noul per candidate
when several may be relevant. Read the top few yourself. Official patterns: re-ranking,
line-by-line search.

**2. Act or ask.** A user instruction admits more than one reasonable reading and acting
on the wrong one is costly (destructive git, external writes, large edits). Ask a Choice
over the readings plus an `unclear` option. Act only when the chosen reading has
confidence ≥ 0.8 and is not `unclear`; otherwise ask the user. Official pattern:
confidence-gated routing.

**3. Check before claiming done.** Put the claim ("all tests pass", "the bug is fixed",
"no call sites remain") and the raw evidence (test output, diff, grep result) in `state`.
Ask a Noul: does the evidence directly support the claim? Below 0.7, go get better
evidence instead of reporting. Official cookbook: double-checking citations.

Put independent questions in one request (speculative fan-out); they run in parallel.

## When not to call it

- Designing an approach, writing code, root-causing: you have far more context than Jev.
- Facts code can settle: exact matches, file existence, test exit codes.
- Anything where you are already confident. Jev is a second opinion, not a gate.

## Reading answers

- Noul: `noul` is P(yes). Near 0.5 means unsure, not "medium".
- Choice / Score: `confidence` is how concentrated the distribution is. Low confidence
  with a harmless choice is fine; low confidence before a risky action means ask.
- Jev is strongest in English. For Chinese input, write `instructions` and `criteria` in
  English and keep the Chinese text in `state`.

## Data

Everything in `state` goes to api.typesafe.ai. Never include secrets, credentials,
connection strings, or `.env` contents.
