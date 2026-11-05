// Build record: logs which tool Kiro used on which path. Shell commands are redacted of anything that looks like a secret.
const fs = require('fs');
let d = '';
process.stdin.on('data', c => (d += c)).on('end', () => {
  try {
    const p = JSON.parse(d);
    const ti = p.tool_input || {};
    let what = ti.path || ti.command || '';
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
