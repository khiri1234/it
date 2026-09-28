// Copies the single-file web app (and its one local asset) from the repo root
// into desktop/app/ so electron-builder can package it. The outer index.html
// stays the single source of truth; this just mirrors it in at build/run time.
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const outDir = path.join(__dirname, '..', 'app');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

fs.copyFileSync(path.join(repoRoot, 'index.html'), path.join(outDir, 'index.html'));

const vendorSrc = path.join(repoRoot, 'vendor');
const vendorOut = path.join(outDir, 'vendor');
fs.mkdirSync(vendorOut, { recursive: true });
for (const f of fs.readdirSync(vendorSrc)) {
  fs.copyFileSync(path.join(vendorSrc, f), path.join(vendorOut, f));
}

console.log('Copied index.html + vendor/ into desktop/app/');
