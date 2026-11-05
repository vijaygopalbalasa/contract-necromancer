# Product: Contract Necromancer

Design by Contract (Eiffel, 1986) never made it into everyday coding. Coding agents need it now: an agent can say a task is
done while the code breaks the requirement, and it can quietly edit its own tests to match a bug.

Contract Necromancer brings contracts back for Kiro specs:
- Every EARS acceptance criterion in `.kiro/specs/<spec>/requirements.md` gets an executable contract in
  `contracts/<spec>/`.
- Once a person freezes them, contracts and requirements cannot be edited during a task.
- A Kiro hook refuses to let a task in `tasks.md` be marked done until the frozen contracts pass.
- Every task that passes gets a receipt anyone can re-run to get the same result and the same receipt hash.

Users: developers who build with Kiro specs and want "done" to mean the requirements are met.
