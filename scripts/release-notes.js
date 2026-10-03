#!/usr/bin/env node
'use strict';
/**
 * Writes the GitHub release notes for the current version to stdout: download
 * links for the Windows builds first, then that version's CHANGELOG entry.
 *
 *   node scripts/release-notes.js [tag]
 *
 * The repository comes from GITHUB_REPOSITORY (set in Actions), so the links
 * point straight at the files attached to the release.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const tag = process.argv[2] || `v${version}`;
const repo = process.env.GITHUB_REPOSITORY || 'classyfiedcat-coder/Ipod';
const file = (name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;

/** The CHANGELOG section for this version, without its heading. */
function changes() {
  const text = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start < 0) return '';
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  // Its sub-headings move up a level under "What's new".
  return lines
    .slice(start + 1, end)
    .map((l) => l.replace(/^### /, '#### '))
    .join('\n')
    .trim();
}

const setup = `iPod-Setup-${version}.exe`;
const portable = `iPod-Portable-${version}.exe`;
const notes = `## ⬇️ Download

| | File | |
| :-- | :-- | :-- |
| **Recommended** | **[${setup}](${file(setup)})** | Installs iPod with Start menu and desktop shortcuts, and keeps it up to date automatically. |
| No install | [${portable}](${file(portable)}) | Runs straight from wherever you save it. Doesn't update itself. |

For Windows 10 and 11 (64-bit). The app isn't code-signed yet, so Windows SmartScreen may warn you the first time: click **More info**, then **Run anyway**.

<sub>\`latest.yml\` and the \`.blockmap\` file below are used by installed copies to update themselves. You don't need to download them.</sub>

## ✨ What's new in ${version}

${changes()}
`;

process.stdout.write(notes);
