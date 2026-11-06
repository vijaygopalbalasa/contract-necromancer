#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeSpec } from '../src/lock.js';
import { verify } from '../src/verify.js';
import { handlePreToolUse, handlePostToolUse, handleStop } from '../src/hooks.js';

const cwd = process.cwd();
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: necro <command> [args]');
  console.error('Commands: freeze <spec>, verify <receiptFile>, init, hook pre|post|stop');
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

// Initialize a project with hook and steering templates.
// Req 8.1, 8.2, 8.3: write files if they don't exist, else report they're already there.
function initProject(cwd) {
  const hookDest = path.join(cwd, '.kiro', 'hooks', 'necromancer.json');
  const steeringDest = path.join(cwd, '.kiro', 'steering', 'necromancer.md');

  // fileURLToPath decodes the URL, so install paths with spaces work.
  const templates = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'templates');
  const hookSrc = path.join(templates, 'necromancer.hooks.json');
  const steeringSrc = path.join(templates, 'necromancer.steering.md');

  let wrote = [];

  if (!fs.existsSync(hookDest)) {
    fs.mkdirSync(path.dirname(hookDest), { recursive: true });
    fs.copyFileSync(hookSrc, hookDest);
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
