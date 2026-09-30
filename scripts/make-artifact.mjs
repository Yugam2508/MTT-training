// Turns dist-single/index.html into a body-only page (title first) that loads React from cdnjs.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-single/index.html', 'utf8');
const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/)?.[0] ?? '';
const head = `<title>MTT Coach</title>
<meta name="description" content="Poker tournament trainer: realistic MTT simulations, a coach that grades every decision, leak analysis, lessons and drills.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
<style>${style}</style>`;
const body = `<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${scripts.join('\n').replace(/<\/script/gi, '<\\/script')}</script>`;
// Artifact page: body-only content (the host adds the document skeleton), title first.
writeFileSync('dist-single/mtt-coach.html', `${head}\n${body}\n`);
// Standalone page: a full document you can open directly in a browser.
writeFileSync('dist-single/standalone.html', `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
${head}
</head><body>
${body}
</body></html>
`);
console.log(`wrote dist-single/mtt-coach.html and standalone.html (${((head.length + body.length) / 1024).toFixed(0)} KB)`);
