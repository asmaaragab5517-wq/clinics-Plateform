#!/usr/bin/env node
// LOC-1 / LOC-2 lint: RTL-first layout and no hardcoded user-facing strings.
// - bans physical direction utilities/properties (ml-, mr-, pl-, pr-, left-, right-, text-left/right, border-l/r, rounded-l/r,
//   margin-left, padding-right, left:, right:) in favour of logical start/end equivalents
// - bans Arabic literals in components (all copy must come from the i18n catalogues)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['.'];
const exts = new Set(['.ts', '.tsx', '.css']);
const physical = [
  /(?<![\w-])(?:-?m|p)[lr]-(?:\d|px|auto|\[)/,
  /(?<![\w-])(?:left|right)-(?:\d|px|auto|full|1\/2|\[)/,
  /(?<![\w-])text-(?:left|right)(?![\w-])/,
  /(?<![\w-])(?:border|rounded)-[lr](?:-|\b)/,
  /(?<![\w-])(?:rounded)-(?:tl|tr|bl|br)(?:-|\b)/,
  /(?:margin|padding|border)-(?:left|right)\s*:/,
  /(?<![\w-])(?:left|right)\s*:\s*[\d-]/,
  /float\s*:\s*(?:left|right)/,
];
const arabic = /[؀-ۿ]/;
let errors = 0;

function walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    if (/node_modules|\.next|dist|i18n|\.expo/.test(p)) return;
    for (const f of readdirSync(p)) walk(join(p, f));
    return;
  }
  if (!exts.has(extname(p))) return;
  const lines = readFileSync(p, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/lint-rtl-ignore/.test(line)) return;
    for (const re of physical) {
      if (re.test(line)) {
        console.error(`${p}:${i + 1}: physical direction - use logical start/end: ${line.trim().slice(0, 120)}`);
        errors++;
        break;
      }
    }
    if (extname(p) === '.tsx' && arabic.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
      console.error(`${p}:${i + 1}: hardcoded Arabic text - move it to the i18n catalogue`);
      errors++;
    }
  });
}

for (const r of roots) walk(r);
if (errors) {
  console.error(`\n${errors} RTL/i18n lint error(s)`);
  process.exit(1);
}
console.log('RTL/i18n lint passed');
