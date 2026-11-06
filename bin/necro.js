#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeSpec } from '../src/lock.js';
import { verify } from '../src/verify.js';
import { checkSpec } from '../src/check.js';
import { handlePreToolUse, handlePostToolUse, handleStop } from '../src/hooks.js';

const cwd = process.cwd();
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: necro <command> [args]');
  console.error('Commands: freeze <spec>, check <spec>, verify <receiptFile>, init, hook pre|post|stop');
  process.exit(1);
}

const cmd = args[0];

try {
  switch (cmd) {
    case 'freeze': {
      if (args.length < 2) {
        console.error('Usage: necro freeze <spec>');
        process.exit(1);
      }
      const spec = args[1];
      freezeSpec(cwd, spec);
      console.log(`Spec '${spec}' frozen.`);
      break;
    }

    case 'check': {
      if (args.length < 2) {
        console.error('Usage: necro check <spec>');
        process.exit(1);
      }
      const result = checkSpec(cwd, args[1]);
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
      process.exit(result.exitCode);
    }

    case 'verify': {
      if (args.length < 2) {
        console.error('Usage: necro verify <receiptFile>');
        process.exit(1);
      }
      const receiptFile = args[1];
      const exitCode = verify(cwd, receiptFile);
      process.exit(exitCode);
    }

    case 'init': {
      initProject(cwd);
      break;
    }

    case 'hook': {
      if (args.length < 2) {
        console.error('Usage: necro hook pre|post|stop');
        process.exit(1);
      }
      const hookType = args[1];
      handleHook(cwd, hookType);
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// Quote a path for a shell command line. Double quotes work in sh, cmd and
// PowerShell; on POSIX the characters that stay special inside them get a backslash.
function shellQuote(p) {
  if (process.platform === 'win32') return `"${p}"`;
  return `"${p.replace(/[\\"$`]/g, '\\$&')}"`;
}

// Initialize a project with hook and steering templates.
// Req 8.1, 8.2, 8.3: write files if they don't exist, else report they're already there.
// Req 8.6: hook commands use the absolute node and necro.js paths, because the
// Kiro IDE started from the Dock does not have the shell's PATH.
function initProject(cwd) {
  const hookDest = path.join(cwd, '.kiro', 'hooks', 'necromancer.json');
  const steeringDest = path.join(cwd, '.kiro', 'steering', 'necromancer.md');

  // fileURLToPath decodes the URL, so install paths with spaces work.
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const templates = path.join(root, 'templates');
  const hookSrc = path.join(templates, 'necromancer.hooks.json');
  const steeringSrc = path.join(templates, 'necromancer.steering.md');

  let wrote = [];

  if (!fs.existsSync(hookDest)) {
    const prefix = `${shellQuote(process.execPath)} ${shellQuote(path.join(root, 'bin', 'necro.js'))}`;
    const config = JSON.parse(fs.readFileSync(hookSrc, 'utf8'));
    for (const hook of config.hooks) {
      hook.action.command = hook.action.command.replace(/^necro /, () => `${prefix} `);
    }
    fs.mkdirSync(path.dirname(hookDest), { recursive: true });
    fs.writeFileSync(hookDest, JSON.stringify(config, null, 2) + '\n');
    wrote.push(hookDest);
  }

  if (!fs.existsSync(steeringDest)) {
    fs.mkdirSync(path.dirname(steeringDest), { recursive: true });
    fs.copyFileSync(steeringSrc, steeringDest);
    wrote.push(steeringDest);
  }

  if (wrote.length === 0) {
    console.log('Necromancer hook and steering files already exist. Left unchanged.');
  } else {
    console.log(`Wrote: ${wrote.join(', ')}`);
  }
  // Req 8.7
  console.log('Kiro runs hooks only in a trusted workspace. Trust this workspace, then quit and reopen Kiro.');
}

// Handle hook commands - read payload from stdin and dispatch.
function handleHook(cwd, hookType) {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(input);
      payload.cwd = payload.cwd || cwd;

      let result;
      switch (hookType) {
        case 'pre':
          result = handlePreToolUse(payload);
          break;
        case 'post':
          result = handlePostToolUse(payload);
          break;
        case 'stop':
          result = handleStop(payload);
          break;
        default:
          console.error(`Unknown hook type: ${hookType}`);
          process.exit(2);
      }

      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
      process.exit(result.exitCode || 0);
    } catch (e) {
      console.error(`Hook error: ${e.message}`);
      process.exit(2);
    }
  });
}
