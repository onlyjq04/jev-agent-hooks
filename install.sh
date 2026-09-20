#!/usr/bin/env bash
# Symlinks this checkout into the agent config dirs, so `git pull` updates everything.
# Only touches hosts that are actually installed. Never edits settings.json — the hook
# registrations in config/ are yours to paste in (see README).
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
link() { mkdir -p "$(dirname "$2")"; ln -sfn "$1" "$2"; echo "  $2 -> $1"; }

echo "hooks:"
for f in "$SRC"/hooks/*.mjs; do link "$f" "$HOME/.claude/hooks/$(basename "$f")"; done
link "$SRC/hooks/jev-cli.mjs" "$HOME/.local/bin/jev"

echo "claude:"
for d in "$SRC"/skills/*/; do link "${d%/}" "$HOME/.claude/skills/$(basename "$d")"; done
for f in "$SRC"/agents/*.md; do link "$f" "$HOME/.claude/agents/$(basename "$f")"; done

# jev-decide is host-agnostic; ~/.agents/skills is where codex, pi and omp look
echo "shared skills:"
link "$SRC/skills/jev-decide" "$HOME/.agents/skills/jev-decide"

if [ -d "$HOME/.pi/agent" ]; then
  echo "pi:"
  for f in "$SRC"/pi/extensions/*.ts; do link "$f" "$HOME/.pi/agent/extensions/$(basename "$f")"; done
fi

echo
echo "Next: export TYPESAFE_API_KEY, then register the hooks —"
echo "  claude: merge config/claude-settings.snippet.json into ~/.claude/settings.json"
echo "  codex:  merge config/codex-hooks.snippet.json into ~/.codex/hooks.json, then trust it with /hooks"
echo "  pi:     nothing to do, extensions load from ~/.pi/agent/extensions"
