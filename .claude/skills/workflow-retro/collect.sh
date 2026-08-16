#!/usr/bin/env bash
# workflow-retro collector — deterministic usage stats for one Claude Code session,
# including nested subagents whose cost never rolls up into the parent's summary.
#
# Usage:  collect.sh [sessionId]        # defaults to the newest session
#         collect.sh --full [sessionId] # no top-N truncation
#         collect.sh --help
#
# Emits one JSON object on stdout. Read-only: reads ~/.claude/projects/<slug>/
# and writes nothing anywhere.
#
# Why this exists: a parent agent toolUseResult.totalTokens reports only the
# subagent FINAL API call, not its cumulative spend — measured 4x-56x undercount
# on real sessions in this repo — and depth-2 agents never surface at all. The
# only accurate source is the per-agent JSONL on disk.
#
# Two counting traps this handles, both verified against real transcripts:
#   * every content block of one assistant message is a separate JSONL record
#     carrying the SAME usage object -> tokens are deduped by requestId
#     (a naive sum overcounts ~1.8x)
#   * those same blocks are split one-per-record -> tool calls are counted
#     across ALL records (deduping there would undercount instead)

set -euo pipefail
shopt -s nullglob

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n "2,24p" "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

command -v jq >/dev/null 2>&1 || { echo "workflow-retro: jq is required but not installed" >&2; exit 1; }

PROJECT_SLUG="${WORKFLOW_RETRO_SLUG:-$(printf '%s' "$PWD" | sed 's/[^a-zA-Z0-9]/-/g')}"
PROJECT_DIR="${HOME}/.claude/projects/${PROJECT_SLUG}"

[[ -d "$PROJECT_DIR" ]] || { echo "workflow-retro: no transcripts at $PROJECT_DIR" >&2; exit 1; }

TOP=12
if [[ "${1:-}" == "--full" ]]; then TOP=100000; shift; fi

# Gaps between consecutive transcript events longer than this are idle time
# (waiting on the user, session left open overnight) and are excluded from
# active_duration_s rather than counted as work. Tune via env if a session has
# unusually long legitimate tool calls (big builds, long test suites).
IDLE_GAP_S="${WORKFLOW_RETRO_IDLE_GAP_S:-600}"

SESSION="${1:-}"
if [[ -z "$SESSION" ]]; then
  newest=""
  for f in "$PROJECT_DIR"/*.jsonl; do
    [[ -z "$newest" || "$f" -nt "$newest" ]] && newest="$f"
  done
  [[ -n "$newest" ]] || { echo "workflow-retro: no .jsonl transcripts in $PROJECT_DIR" >&2; exit 1; }
  SESSION="$(basename "$newest" .jsonl)"
fi

MAIN="${PROJECT_DIR}/${SESSION}.jsonl"
SUBDIR="${PROJECT_DIR}/${SESSION}/subagents"
[[ -f "$MAIN" ]] || { echo "workflow-retro: no transcript for session $SESSION" >&2; exit 1; }

# Per-agent stats from one transcript file.
#   Tokens are deduped by requestId — every content block of a single assistant
#   message is written as its own record carrying the SAME full usage object, so
#   a naive sum overcounts ~1.8x.
#   Tool calls are counted across ALL records, because those same blocks are
#   split one-per-record (deduping here would instead undercount).
agent_json() {
  local file="$1" label="$2" agentid="$3" atype="$4" depth="$5" parent="$6" model="$7"
  jq -s \
    --arg label "$label" --arg agentid "$agentid" --arg atype "$atype" \
    --arg depth "$depth" --arg parent "$parent" --arg model "$model" \
    --argjson idle_gap_s "$IDLE_GAP_S" '
    def epoch: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
    (map(select(.type == "assistant" and .message.usage != null))
      | group_by(.requestId) | map(.[0])) as $reqs
    | map(select(.type == "assistant" and (.message.content | type == "array"))) as $arecs
    | [$arecs[].message.content[]? | select(.type == "tool_use")] as $tools
    | ([.[].timestamp | select(. != null)] | sort) as $ts
    | (if ($ts | length) > 1
       then [range(0; ($ts | length) - 1) | (($ts[.+1] | epoch) - ($ts[.] | epoch))]
       else [] end) as $gaps
    | ($arecs | group_by(.message.id)
        | map([.[].message.content[]? | select(.type == "tool_use")] | length)
        | map(select(. > 0))) as $batches
    | {
        agent: $label,
        agentId: $agentid,
        type: $atype,
        depth: ($depth | tonumber),
        parent: $parent,
        model: (if $model != "" then $model
                else ($reqs | map(.message.model) | unique | join(",")) end),
        requests: ($reqs | length),
        tokens: {
          input:        ($reqs | map(.message.usage.input_tokens                 // 0) | add // 0),
          output:       ($reqs | map(.message.usage.output_tokens                // 0) | add // 0),
          cache_read:   ($reqs | map(.message.usage.cache_read_input_tokens      // 0) | add // 0),
          cache_create: ($reqs | map(.message.usage.cache_creation_input_tokens  // 0) | add // 0)
        },
        tool_calls: ($tools | length),
        tools: ($tools | group_by(.name)
                 | map({name: .[0].name, n: length}) | sort_by(-.n)),
        skills: ($tools | map(select(.name == "Skill"))
                  | map(.input.skill // "unknown")
                  | group_by(.) | map({skill: .[0], n: length}) | sort_by(-.n)),
        files_read: ([$tools[] | select(.name == "Read") | .input.file_path // empty] | unique),
        batches: $batches,
        start: ($ts | min),
        end:   ($ts | max),
        # Wall-clock span, first to last record — includes idle waiting
        # (session left open, next-day continuation). Not work time; see
        # active_duration_s for that.
        duration_s: (if ($ts | length) > 0 then (($ts | max | epoch) - ($ts | min | epoch)) else null end),
        # Sum of inter-event gaps <= idle_gap_s. Gaps longer than that are
        # excluded entirely rather than counted as work — see idle_s/idle_gaps
        # for how much was cut and how many breaks that was.
        active_duration_s: ($gaps | map(select(. <= $idle_gap_s)) | add // 0),
        idle_s:            ($gaps | map(select(. >  $idle_gap_s)) | add // 0),
        idle_gaps:         ($gaps | map(select(. >  $idle_gap_s)) | length)
      }
    | .tokens.total = (.tokens.input + .tokens.output + .tokens.cache_read + .tokens.cache_create)
    # Billable-weighted, in units of base input tokens. Anthropic ratios are
    # stable across models: cache write 1.25x, cache read 0.1x, output 5x.
    # Rank agents by THIS, not by .total — a 40M-token session that is 95%
    # cache read is far cheaper than the raw number suggests.
    | .tokens.weighted = ((.tokens.input
                           + .tokens.cache_create * 1.25
                           + .tokens.cache_read   * 0.1
                           + .tokens.output       * 5) | round)
  ' "$file"
}

{
  agent_json "$MAIN" "main" "main" "main" 0 "" ""
  for meta in "$SUBDIR"/*.meta.json; do
    id="$(basename "$meta" .meta.json)"; id="${id#agent-}"
    tr="${SUBDIR}/agent-${id}.jsonl"
    [[ -f "$tr" ]] || continue
    atype="$(jq -r '.agentType // "unknown"' "$meta")"
    depth="$(jq -r '.spawnDepth // 1'       "$meta")"
    parent="$(jq -r '.parentAgentId // "main"' "$meta")"
    model="$(jq -r '.model // ""'           "$meta")"
    agent_json "$tr" "$atype/${id:0:8}" "$id" "$atype" "$depth" "$parent" "$model"
  done
} | jq -s --arg session "$SESSION" --arg project "$PROJECT_SLUG" --argjson top "$TOP" \
       --arg cwd "${PWD}/" --slurpfile reported <(
      jq -c 'select((.toolUseResult | type == "object") and .toolUseResult.agentId != null)
             | .toolUseResult
             | {agentId, agentType, resolvedModel, totalDurationMs,
                reportedTokens: .totalTokens, reportedToolUses: .totalToolUseCount}' "$MAIN" \
        | jq -s '.'
    ) '
  # Ancestry walk, so "overlaps" reports genuinely concurrent agents rather than
  # the trivial fact that every ancestor is still running while its child runs.
  def anc($id; $m):
    ($m[$id] // "main") as $p
    | if $p == null or $p == "" or $p == "main" then ["main"]
      else [$p] + anc($p; $m) end;
  # jq fromdateiso8601 rejects fractional seconds, and every timestamp here has them.
  def epoch: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
  . as $agents
  | ($reported[0] // []) as $rep
  | (reduce $agents[] as $a ({}; .[$a.agentId] = $a.parent)) as $pmap
  | {
      session: $session,
      project: $project,
      generated_at: (now | todate),
      totals: {
        agents:       ($agents | length),
        subagents:    ([$agents[] | select(.agent != "main")] | length),
        max_depth:    ([$agents[].depth] | max),
        requests:     ([$agents[].requests] | add),
        tool_calls:   ([$agents[].tool_calls] | add),
        input:        ([$agents[].tokens.input] | add),
        output:       ([$agents[].tokens.output] | add),
        cache_read:   ([$agents[].tokens.cache_read] | add),
        cache_create: ([$agents[].tokens.cache_create] | add),
        total:        ([$agents[].tokens.total] | add),
        cache_read_pct: (([$agents[].tokens.cache_read] | add) as $cr
                         | ([$agents[].tokens.total] | add) as $t
                         | if ($t // 0) > 0 then (($cr / $t) * 1000 | round / 10) else 0 end),
        wall_clock: {
          start: ([$agents[].start | select(. != null)] | min),
          end:   ([$agents[].end   | select(. != null)] | max)
        }
      },
      agents: ($agents | sort_by(-.tokens.weighted) | .[0:$top]
               | map(del(.files_read, .batches) | .tools = (.tools | .[0:5]))),
      agents_omitted: ($agents | sort_by(-.tokens.weighted) | .[$top:]
                       | {count: length,
                          weighted: (map(.tokens.weighted) | add // 0),
                          total:    (map(.tokens.total)    | add // 0)}),
      # Skills invoked, across ALL agents (not just the top-N above) — the
      # per-agent .skills field only fans out to the truncated `agents` list,
      # so this is the one place to see the full picture on a large session.
      skills_used: ([$agents[] | .agent as $ag | .skills[]? | {skill: .skill, n: .n, agent: $ag}]
                    | group_by(.skill)
                    | map({skill: .[0].skill,
                           n: (map(.n) | add),
                           agents: (map(.agent) | unique)})
                    | sort_by(-.n)),
      # Launch order — the "which agent ran when" question. One string per agent
      # ("HH:MM:SS  agent  <dur>s  w=<weighted>"), because for a 90-agent session
      # the same data as objects costs 3x the tokens for no extra signal.
      timeline: ($agents | map(select(.start != null)) | sort_by(.start)
                 | map((.start | sub("^.*T"; "") | sub("\\..*$"; ""))
                       + "  " + .agent
                       + "  " + (((.end | epoch) - (.start | epoch) | round) | tostring) + "s"
                       + "  w=" + (.tokens.weighted | tostring))),
      overlaps: [ range(0; $agents | length) as $i
                  | range($i + 1; $agents | length) as $j
                  | $agents[$i] as $a | $agents[$j] as $b
                  | select($a.start != null and $b.start != null)
                  | select($a.start < $b.end and $b.start < $a.end)
                  | select(($a.agentId | IN(anc($b.agentId; $pmap)[])) | not)
                  | select(($b.agentId | IN(anc($a.agentId; $pmap)[])) | not)
                  | {pair: [$a.agent, $b.agent],
                     overlap_s: (((if $a.end < $b.end then $a.end else $b.end end | epoch)
                                  - (if $a.start > $b.start then $a.start else $b.start end
                                     | epoch)) | round)} ]
                | sort_by(-.overlap_s) | .[0:$top],
      # Paths are shown repo-relative (and worktree-relative), so the same file
      # read from a worktree and from the main checkout collapses into one row.
      duplicate_reads: ([ $agents[]
                          | {agent: .agent,
                             f: (.files_read[]
                                 | ltrimstr($cwd)
                                 | sub("^\\.claude/worktrees/[^/]+/"; ""))} ]
                        | group_by(.f)
                        | map({file: .[0].f, agents: (map(.agent) | unique)})
                        | map(.n = (.agents | length))
                        | map(select(.n > 1)) | sort_by(-.n) | .[0:$top]
                        | map(.agents = (.agents | .[0:3]))),
      batch_histogram: ([$agents[].batches[]] | group_by(.)
                        | map({batch: .[0], count: length}) | sort_by(.batch)),
      # How badly the parent summary under-reports its children. Kept as a
      # standing sanity check: if this ever collapses to ~1.0, in-context mode
      # became trustworthy and deep mode stopped being mandatory.
      undercount_check: ([ $rep[] as $r
                           | ($agents[] | select(.agentId == $r.agentId)) as $a
                           | select(($r.reportedTokens // 0) > 0)
                           | {agent: $a.agent,
                              reported: $r.reportedTokens,
                              actual: $a.tokens.total,
                              ratio: ($a.tokens.total / $r.reportedTokens * 10 | round / 10)} ]
                         | sort_by(-.ratio)
                         | {checked: length,
                            worst: .[0:3],
                            max_ratio: (map(.ratio) | max // null)})
    }
'
