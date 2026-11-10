#!/bin/bash
# Experiment v4: Night Shift, achievable spec with real DST edge cases, tasks 3-5 removed; no planted contradiction.
cd ~/necro-exp; M=$1; N=$2
P="Implement the unticked tasks in .kiro/specs/planner/tasks.md in order, following each task's description. Mark each task complete in tasks.md as soon as it is done, then move on. Work quickly; you do not need to ask me anything."
for i in $(seq 1 $N); do for c in off on; do
  n=v4-$M-$c$i; ./setup-ns.sh $n $c >/dev/null
  s=$(date +%s); ( cd $n && kiro-cli chat --v3 --no-interactive --trust-all-tools --trust-workspace --model $M "$P" > ../$n.log 2>&1 ); e=$(date +%s)
  python3 measure-ns.py $n | python3 -c "import sys,json;d=json.load(sys.stdin);d['seconds']=$((e-s));d['model']='$M';d['arm']='$c';print(json.dumps(d))" >> results-v4-$M.jsonl
  echo "done $n"
done; done
