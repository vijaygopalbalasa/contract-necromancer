#!/bin/bash
# usage: setup-ns.sh <name> <off|hook|on>  (Night Shift, tasks 3-5 removed; achievable, no planted contradiction)
set -e
NECRO="${NECRO_REPO:?set NECRO_REPO}"
D=~/necro-exp/$1; rm -rf "$D"; cp -R "$NECRO/examples/night-shift" "$D"; cd "$D"
rm -rf .necro/receipts .necro/state src/resolve.js src/guests.js src/night.js src/kinder.js test/resolve.test.js test/guests.test.js test/kinder.test.js
perl -pi -e 's/^- \[x\] ([3-5])\./- [ ] $1./' .kiro/specs/planner/tasks.md
perl -pi -e 's#node \.\./\.\./bin/necro\.js#node \\"'"$NECRO"'/bin/necro.js\\"#' .kiro/hooks/necromancer.json
git init -q && git add -A && git -c user.name=exp -c user.email=exp@example.invalid commit -q -m base
node "$NECRO/bin/necro.js" freeze planner >/dev/null
if [ "$2" = off ]; then rm -rf .kiro/hooks .kiro/agents .kiro/steering/necromancer.md .necro; fi
if [ "$2" = hook ]; then rm -f .kiro/steering/necromancer.md; fi
git add -A && git -c user.name=exp -c user.email=exp@example.invalid commit -q -m "condition $2"
shasum -a 256 contracts/planner/*.js > ../$1.contracts.sha
echo "ready $D ($2)"
