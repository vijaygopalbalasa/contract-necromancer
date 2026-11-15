#!/bin/bash
# Same prompt, same model, gate on vs off. Set MODEL to the Kiro model id to test (the recorded runs used model A).
cd ~/necro-exp
P="Implement the unticked tasks in .kiro/specs/ledger/tasks.md in order, following each task's description. Mark each task complete in tasks.md as soon as it is done, then move on. Work quickly; you do not need to ask me anything."
for i in 1 2 3; do for c in off on; do
  n=$c$i; ./setup.sh $n $c >/dev/null
  ( cd $n && kiro-cli chat --v3 --no-interactive --trust-all-tools --trust-workspace --model "${MODEL:?set MODEL to a Kiro model id}" "$P" > ../$n.log 2>&1 )
  python3 measure.py $n >> results.jsonl
  echo "done $n" 
done; done
