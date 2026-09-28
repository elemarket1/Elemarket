#!/usr/bin/env node
import { browserPolicy } from '../src/lib/providers/browser-policy.mjs';
try {
  const policy = browserPolicy();
  const missing = policy.build.filter(key => !process.env[key]?.trim());
  if (missing.length) throw new Error(`push: missing selected browser adapter configuration ${missing.join(', ')}`);
  console.log('[push] selected browser adapter build configuration validated');
} catch (error) { console.error(`[push] ${error.message}`); process.exit(1); }
