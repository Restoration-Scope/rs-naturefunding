#!/bin/bash
# Drives chatgpt.com (Bernat's Pro plan, signed in in Chrome Profile 3) for gpt-pro.ts, through a headless
# Claude with only the Chrome tools (the same route as agent-harness/scripts/rs-chrome.sh). Answers are taken
# from the browser tool's own output in the run's event stream, never retyped by the model.
#
#   gpt-pro-browser.sh send <id>            attach .cache/gpt-pro/prompts/<id>.txt in a new Pro chat, send it,
#                                           append "<id>\t<chat url>\t<time>" to .cache/gpt-pro/sent.tsv
#   gpt-pro-browser.sh collect <id> <url>   if the chat has finished, write its JSON block to
#                                           .cache/gpt-pro/answers/<id>.txt (exit 0); still thinking: exit 75
#
# Run from the repo root of the main checkout (prompts must sit in a folder the session may read).
# Env: GPT_PRO_LOGINS (config dirs to try, default ".claude-rs-b .claude-ultra"), GPT_PRO_MODEL (default haiku).
set -uo pipefail
DEVICE=e1d393c9
LOGINS=(${GPT_PRO_LOGINS:-.claude-rs-b .claude-ultra})
MODEL="${GPT_PRO_MODEL:-haiku}"
ROOT="$(pwd -P)"
DIR="$ROOT/.cache/gpt-pro"
mkdir -p "$DIR/answers" "$DIR/logs"

cmd="${1:-}"; id="${2:-}"
[[ "$id" =~ ^[a-z0-9-]+$ ]] || { echo "usage: send <id> | collect <id> <url>" >&2; exit 2; }

PRE="You are a headless browser helper. 1. Call list_connected_browsers; if no deviceId starts with $DEVICE print exactly UNREACHABLE and stop; if several, select_browser that one. 2. Work only in a new tab you create with tabs_create_mcp; close it at the end with tabs_close_mcp. Never type passwords, never change settings."

if [ "$cmd" = send ]; then
  prompt="$DIR/prompts/$id.txt"
  [ -f "$prompt" ] || { echo "no prompt $prompt" >&2; exit 2; }
  step="$PRE
3. Navigate the tab to https://chatgpt.com/ and wait 3 seconds.
4. Use find to get the hidden file input labelled \"Attach files\" and upload $prompt to it with file_upload.
5. Click the \"Ask ChatGPT\" textbox and type exactly: naturefunding.org requirements check, programme $id. Follow every instruction in the attached file exactly and reply with the single JSON code block it asks for.
6. Wait 3 seconds, find the button named \"Send\" and click it. Wait 8 seconds.
7. Run javascript_tool with: location.href  — it must start with https://chatgpt.com/c/ and must not contain local-chatgpt; if it does, wait 5 seconds and run it again (up to 4 times).
8. Close your tab (ChatGPT keeps working on the server). Print only the final chat URL."
  allow=(mcp__claude-in-chrome "Read($prompt)"); extra=(--add-dir "$DIR/prompts"); tools="Read"
elif [ "$cmd" = collect ]; then
  url="${3:-}"; [[ "$url" =~ ^https://chatgpt\.com/c/[A-Za-z0-9-]+$ ]] || { echo "bad url" >&2; exit 2; }
  # The browser tool cuts each result at about 1,000 characters, so the answer comes back in numbered
  # 900-character chunks of its compact JSON; each chunk call recomputes the text, so no page state is needed.
  text="(() => { const blocks = [...document.querySelectorAll('[data-message-author-role=\"assistant\"] pre code, main pre code')].map(c => c.innerText); const last = blocks.at(-1) || ''; try { return JSON.stringify(JSON.parse(last)) } catch { return last } })()"
  count="(() => { const busy = !!document.querySelector('[data-testid=\"stop-button\"]'); const t = $text; return busy || !t ? 'NFSTATUS:BUSY' : 'NFCOUNT:' + Math.ceil(t.length / 900) })()"
  chunk="(() => { const t = $text; return 'NFC' + I + '<<' + t.slice(I * 900, I * 900 + 900) + '>>NFC' })()"
  step="$PRE
3. Navigate the tab to $url and wait 10 seconds for the conversation to load.
4. Call javascript_tool directly (never inside browser_batch) with exactly this code: $count
5. If it returned NFCOUNT:N, then for each I from 0 to N-1 call javascript_tool directly with exactly this code, with I replaced by the number: $chunk
6. Close your tab. Print only DONE."
  allow=(mcp__claude-in-chrome); extra=(); tools=""
else
  echo "usage: send <id> | collect <id> <url>" >&2; exit 2
fi

log="$DIR/logs/$cmd-$id-$(date +%s).jsonl"
for login in "${LOGINS[@]}"; do
  ( cd "${TMPDIR:-/tmp}" && env -i HOME="$HOME" USER="$USER" LOGNAME="$USER" PATH="$PATH" LANG="${LANG:-en_US.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" \
    CLAUDE_CONFIG_DIR="$HOME/$login" perl -e 'alarm shift; exec @ARGV or die "exec: $!\n"' 420 \
    claude -p "$step" --chrome --model "$MODEL" --tools "$tools" --strict-mcp-config --no-session-persistence \
      --output-format stream-json --verbose ${extra[@]+"${extra[@]}"} --allowedTools "${allow[@]}" < /dev/null ) > "$log" 2> "$log.err"
  result=$(jq -r 'select(.type=="result") | .result // empty' "$log" 2>/dev/null | tail -1)
  [ "$result" = UNREACHABLE ] || break
done

if [ "$cmd" = send ]; then
  chat=$(grep -o 'https://chatgpt.com/c/[A-Za-z0-9-]*' <<< "$result" | tail -1)
  [ -n "$chat" ] || { echo "send $id failed: ${result:0:300} (log $log)" >&2; exit 1; }
  printf '%s\t%s\t%s\n' "$id" "$chat" "$(date -u +%FT%TZ)" >> "$DIR/sent.tsv"
  echo "$chat"
else
  # The javascript_tool output as the browser returned it, from the stream (tool results are in user events).
  out=$(jq -r 'select(.type=="user") | .message.content[]? | select(.type=="tool_result") | (.content | if type=="array" then map(.text // "") | join("") else . end)' "$log" 2>/dev/null)
  if grep -q 'NFSTATUS:BUSY' <<< "$out"; then exit 75; fi
  n=$(grep -o 'NFCOUNT:[0-9]*' <<< "$out" | tail -1 | cut -d: -f2)
  [ -n "$n" ] || { echo "collect $id: no answer found (log $log)" >&2; exit 1; }
  body=$(N="$n" perl -0ne 'my %c; $c{$1} = $2 while /NFC(\d+)<<(.*?)>>NFC/sg; for my $i (0 .. $ENV{N} - 1) { exists $c{$i} or die "missing chunk $i\n"; print $c{$i} }' <<< "$out") \
    || { echo "collect $id: incomplete answer, $n chunks expected (log $log)" >&2; exit 1; }
  printf '%s' "$body" > "$DIR/answers/$id.txt"
  echo "$DIR/answers/$id.txt"
fi
