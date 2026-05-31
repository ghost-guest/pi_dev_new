# Fix Fold/Unfold Without Summaries

## Problem

The current `/fold` extension treats fold as summarization/compaction: it builds conversation text, calls an AI model when possible, writes a hidden `fold-summary` custom message, and lets later context use the summary in place of earlier history. That is not the desired behavior.

## Desired Behavior

- `/fold [instruction]` must mean fold/collapse, not summarize.
- `/fold` must not call any model and must not generate a summary.
- `/fold` should write only hidden control metadata that marks older session entries as folded.
- `/unfold` should find the active fold and write hidden control metadata that restores the full original history.
- Original session history must remain intact.
- User-facing text should describe folding/unfolding, not summary generation.

## Scope

- Update the active user extension at `/Users/mac_522/.pi/agent/extensions/fold.ts`.
- Update the canonical config copy at `/Users/mac_522/Desktop/pi_dev/pi-config/agent/extensions/fold.ts`.
- Do not modify unrelated package changes.

## Verification

- Type-check the extension with the existing temporary tsconfig approach or equivalent.
- Run Pi offline with the extension loaded to verify it registers.
- Exercise `/fold` and `/unfold` in a fabricated session or tmux session enough to prove `/fold` writes fold metadata and `/unfold` restores it without summary text.
