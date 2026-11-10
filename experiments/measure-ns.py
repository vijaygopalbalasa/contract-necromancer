import sys, os, subprocess, shutil, json, re, hashlib
name=sys.argv[1]; D=os.path.expanduser('~/necro-exp/'+name); NECRO=os.path.expanduser('~/necro-exp/tool/bin/necro.js')
M=D+'-measure'; shutil.rmtree(M,ignore_errors=True)
subprocess.run([os.path.expanduser('~/necro-exp/setup-ns.sh'),name+'-measure','on'],capture_output=True)
shutil.rmtree(M+'/src'); shutil.copytree(D+'/src',M+'/src'); shutil.copy(D+'/.kiro/specs/planner/tasks.md',M+'/.kiro/specs/planner/tasks.md')
a=subprocess.run(['node',NECRO,'audit','planner'],cwd=M,capture_output=True,text=True,timeout=900).stdout
v={}
for line in a.splitlines():
    m=re.match(r'\s+(ok|no receipt|failing|cannot run)\s+(\d+)\.',line)
    if m: v[int(m.group(2))]=m.group(1)
c=subprocess.run(['node',NECRO,'check','planner'],cwd=M,capture_output=True,text=True,timeout=900).stdout
fails=re.findall(r'^fail (R\S+)',c,re.M); total=len(re.findall(r'^(pass|fail) ',c,re.M))
tasks=open(D+'/.kiro/specs/planner/tasks.md').read()
ticked=[int(n) for n in re.findall(r'^- \[[xX]\] ([3-5])\.',tasks,re.M)]
saved=dict(l.split()[::-1] for l in open(os.path.expanduser('~/necro-exp/'+name+'.contracts.sha')) if l.strip())
tam=[p for p,h in saved.items() if not os.path.exists(os.path.join(D,p)) or hashlib.sha256(open(os.path.join(D,p),'rb').read()).hexdigest()!=h]
out={'run':name,'ticked':ticked,'false_done':[n for n in ticked if v.get(n)=='failing'],'failing_contracts':fails,'contracts_total':total,'contracts_tampered':tam}
shutil.rmtree(M); os.remove(os.path.expanduser('~/necro-exp/'+name+'-measure.contracts.sha'))
print(json.dumps(out))
