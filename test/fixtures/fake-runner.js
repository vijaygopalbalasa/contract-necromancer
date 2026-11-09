// A fake test framework for the tests of Requirement 13. It needs no Python.
// Usage: node fake-runner.js <contract file> <report path> [more arguments]
//
// The contract file holds one line per testcase: "pass <name>", "fail <name>",
// "error <name>" or "skip <name>". Directives start with "@":
//   @print <text>   print text (a fake "pass" the gate must not believe)
//   @no-report      exit 0 without writing a report
//   @bad-xml        write a report that is not well-formed
//   @empty          write a report with no testcase
//   @exit <n>       exit with code n after writing the report
//   @sleep <ms>     wait before going on (a hang, with a large number)
//   @child <file>   start a child process that stays alive, and write its process id to <file>
// When FAKE_RUNNER_LOG is set, one JSON line about the call is appended to that file.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const [file, report] = process.argv.slice(2);
function pycacheEntries() {
  try {
    return fs.readdirSync(process.env.PYTHONPYCACHEPREFIX);
  } catch {
    return null;
  }
}
if (process.env.FAKE_RUNNER_LOG) {
  fs.appendFileSync(
    process.env.FAKE_RUNNER_LOG,
    JSON.stringify({
      file,
      report,
      cwd: process.cwd(),
      argv: process.argv.slice(2),
      pycachePrefix: process.env.PYTHONPYCACHEPREFIX ?? null,
      pycacheEntries: pycacheEntries(),
      dontWriteBytecode: process.env.PYTHONDONTWRITEBYTECODE ?? null,
    }) + '\n',
  );
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let cases = '';
let mode = 'normal';
let exitCode = 0;
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (line.trim() === '') continue;
  const space = line.indexOf(' ');
  const kind = space < 0 ? line : line.slice(0, space);
  const rest = space < 0 ? '' : line.slice(space + 1);
  if (kind === '@print') console.log(rest);
  else if (kind === '@no-report') mode = 'none';
  else if (kind === '@bad-xml') mode = 'bad';
  else if (kind === '@empty') mode = 'empty';
  else if (kind === '@exit') exitCode = Number(rest);
  else if (kind === '@sleep') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(rest));
  else if (kind === '@child') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(rest, String(child.pid));
  }
  else if (kind === 'pass') cases += `<testcase classname="fake" name="${esc(rest)}"/>`;
  else if (kind === 'fail') cases += `<testcase classname="fake" name="${esc(rest)}"><failure message="failed">x</failure></testcase>`;
  else if (kind === 'error') cases += `<testcase classname="fake" name="${esc(rest)}"><error message="error">x</error></testcase>`;
  else if (kind === 'skip') cases += `<testcase classname="fake" name="${esc(rest)}"><skipped message="skipped"/></testcase>`;
}

if (mode === 'bad') fs.writeFileSync(report, '<testsuite><testcase name="R1.1 half">');
else if (mode === 'empty') fs.writeFileSync(report, '<testsuite tests="0"></testsuite>');
else if (mode !== 'none') fs.writeFileSync(report, `<?xml version="1.0"?><testsuites><testsuite name="fake">${cases}</testsuite></testsuites>`);
process.exit(exitCode);
