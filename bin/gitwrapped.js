#!/usr/bin/env node
import { run } from '../src/cli.js';

// A closed pipe (e.g. `gitwrapped | head -1`) is not an error worth a stack trace.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
    if (err.code !== 'EPIPE') throw err;
  });
}

process.exitCode = await run(process.argv.slice(2));
