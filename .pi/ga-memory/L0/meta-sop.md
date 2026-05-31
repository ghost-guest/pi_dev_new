# GA Memory Meta-SOP

Core rules:

1. Action-verified only: write durable memory only from successful tool results, inspected files, passing commands, or explicit user instruction.
2. No guessing: never store model speculation, unexecuted plans, or unstable transient state as facts.
3. Preserve evidence: every L2/L3 write must include a short evidence pointer.
4. L1 stays tiny: L1 is an index, not a knowledge base.
5. Prefer pointers: keep large artifacts out of prompt context and reference file paths instead.
6. User secrets: never copy secret values into memory; store only safe pointers.
