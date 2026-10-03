#!/usr/bin/env node
'use strict';
/** Release notes for a tag: download links, then the CHANGELOG entry. Usage: node scripts/release-notes.js [tag] */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const tag = process.argv[2] || `v${version}`;
const repo = process.env.GITHUB_REPOSITORY || 'classyfiedcat-coder/Desktop-IPOD';
const file = (name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;

/** This version's CHANGELOG section, without its heading. */
function changes() {
  const lines = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start < 0) return '';
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .map((l) => l.replace(/^### /, '#### '))
    .join('\n')
    .trim();
}

const setup = `iPod-Setup-${version}.exe`;
const portable = `iPod-Portable-${version}.exe`;
const macArm = `iPod-${version}-mac-arm64.dmg`;
const macIntel = `iPod-${version}-mac-x64.dmg`;
const notes = `## ⬇️ Download

| | |
| :-- | :-- |
| **Windows** (10/11) | **[Installer](${file(setup)})** (updates itself) · [Portable](${file(portable)}) |
| **Mac** (macOS 13+) | **[Apple silicon](${file(macArm)})** · [Intel](${file(macIntel)}) |

Not code-signed yet. Windows: **More info › Run anyway**. Mac: open once, then **System Settings › Privacy & Security › Open Anyway**.

## ✨ What's new in ${version}

${changes()}
`;

process.stdout.write(notes);
