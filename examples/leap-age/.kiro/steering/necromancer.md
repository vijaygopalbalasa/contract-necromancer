# Contract Necromancer

Frozen contracts decide "done". Once a spec is frozen by running `necro freeze <spec>`, its requirements and contract files cannot be edited by the agent. Marking a task done in `tasks.md` is gated on those frozen contracts passing.

Do not edit frozen files. Fix the code instead, and the contracts will validate it. If you find yourself wanting to fix a contract, the real problem is in the code.

To check what's frozen in this project, run `necro freeze <spec>` to freeze a new spec or see what's already frozen.
