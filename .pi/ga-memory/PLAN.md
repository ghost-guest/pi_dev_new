---
name: genericagent-evolve
summary: GenericAgent-inspired self-evolving memory and token-saving extension for pi.
---

# GenericAgent Evolve Extension Plan

## Goal

Build a project-local pi extension that captures GenericAgent's two strongest ideas without modifying pi core:

1. Self-evolution through layered memory.
2. Token saving through short indexes, evidence-based recall, large tool-result externalization, and provider cache retention.

## Architecture

```text
.pi/extensions/ga-evolve.ts        # plugin entrypoint, hot-reloadable with /reload
.pi/ga-memory/
  config.json                      # local plugin config
  L0/meta-sop.md                   # memory constitution
  L1/insight.md                    # compact routing index injected each turn
  L2/facts.jsonl                   # verified append-only fact store
  L3/skills/<skill>/SKILL.md       # generated pi skills, loaded progressively
  L4/sessions/*.jsonl              # session summaries and usage telemetry
  artifacts/tool-results/*.txt     # full text for large tool outputs
  artifacts/user-prompts/*.txt      # original user prompts when deterministic prompt optimization rewrites input
```

## MVP ToDo

- [x] Keep implementation as a project-local extension so pi upgrades are unaffected.
- [x] Create L0/L1/L2/L3/L4 directory and seed files automatically.
- [x] Inject only L0 rules + L1 compact index into system prompt before each agent run.
- [x] Register memory tools:
  - [x] `ga_memory_read`
  - [x] `ga_memory_write`
  - [x] `ga_memory_checkpoint`
- [x] Write verified facts append-only to L2.
- [x] Write reusable workflows as pi skills under L3.
- [x] Auto-discover generated L3 skills via `resources_discover`.
- [x] Archive assistant summaries and usage stats to L4.
- [x] Externalize oversized text tool results and replace context with pointer + head/tail preview.
- [x] Deterministically optimize long user prompts with safe/ultra modes, preserving the original prompt by pointer.
- [x] Add `/ga-memory` command for status, search, cache mode, and prompt optimization mode.
- [x] Prefer pi's built-in provider cache retention instead of fragile payload rewriting.

## Later Enhancements

- [ ] Add BM25/vector search for L2/L3 retrieval.
- [ ] Add periodic L4 -> L2/L3 distillation job with model-assisted evidence checks.
- [ ] Add memory GC/refactor command that preserves verified evidence IDs.
- [ ] Add per-provider cache compatibility profiles for known relay vendors.
- [ ] Add UI panel for memory hits and token savings.
- [ ] Add model-assisted semantic equivalence checker for optional aggressive prompt compression.
