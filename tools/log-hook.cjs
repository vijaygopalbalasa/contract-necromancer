// Build record: logs which tool Kiro used on which path. Shell commands are redacted of anything that looks like a secret.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Split a shell command on && ; | only outside single or double quotes.
function splitCommand(cmd) {
  const parts = [];
  let cur = '';
  let q = '';
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) {
      if (ch === '\\' && q === '"' && i + 1 < cmd.length) { cur += ch + cmd[++i]; continue; }
      if (ch === q) q = '';
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === '&' && cmd[i + 1] === '&') {
      parts.push(cur); cur = ''; i++;
    } else if (ch === ';' || ch === '|') {
      parts.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

// Log project paths relative to the root, and mask the home directory in other absolute paths.
function logPath(raw, root) {
  const s = String(raw);
  if (!path.isAbsolute(s)) return s;
  const rel = path.relative(root, s);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return (rel || '.').split(path.sep).join('/');
  const home = os.homedir();
  if (s === home) return '<home>';
  if (s.startsWith(home + path.sep)) return '<home>' + s.slice(home.length).split(path.sep).join('/');
  return s;
}
let d = '';
process.stdin.on('data', c => (d += c)).on('end', () => {
  try {
    const p = JSON.parse(d);
    const ti = p.tool_input || {};
    // Shell commands: keep only the program names, never arguments.
    let what = ti.path ? logPath(ti.path, p.cwd || process.cwd()) : (ti.command ? splitCommand(String(ti.command)).map(c => c.trim().split(/\s+/).filter(w => !w.startsWith('-') && !w.includes('=')).slice(0, 1).join(' ')).join(' && ') : '');
    what = String(what)
      .replace(/\b(authorization\s*[:=]?\s*(bearer\s+)?|bearer\s+)\S+/gi, '$1[redacted]')
      .replace(/\b([A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*\S+/gi, '$1=[redacted]')
      .replace(/:\/\/[^\s/@]+@/g, '://[redacted]@')
      .slice(0, 200);
    fs.mkdirSync('.kiro/build-log', { recursive: true });
    const id = String(p.session_id || 'unknown').replace(/[^\w-]/g, '');
    fs.appendFileSync(`.kiro/build-log/${id}.jsonl`, JSON.stringify({ t: new Date().toISOString(), tool: p.tool_name, what }) + '\n');
  } catch {}
});
