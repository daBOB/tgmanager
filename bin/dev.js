#!/usr/bin/env node

// This file allows running the TypeScript code directly during development
// without needing to compile first

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tsxPath = join(__dirname, '..', 'node_modules', '.bin', 'tsx');
const indexPath = join(__dirname, '..', 'src', 'index.ts');

// Pass all arguments to tsx
const args = [indexPath, ...process.argv.slice(2)];

const child = spawn(tsxPath, args, {
  stdio: 'inherit',
  shell: true
});

child.on('exit', (code) => {
  process.exit(code || 0);
});