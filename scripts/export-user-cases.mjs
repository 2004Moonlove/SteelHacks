import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const catalog = await readFile(new URL('docs/CASE_CATALOG.md', root), 'utf8');
const cases = [];
let category = '';

for (const line of catalog.split(/\r?\n/)) {
  if (line.startsWith('## ')) category = line.slice(3).trim();
  const match = line.match(/^\| (\d{3}) \| (.+) \|$/);
  if (!match) continue;
  const [, id, input] = match;
  if (!category || input.includes('|') || Number(id) !== cases.length + 1) {
    throw new Error(`Invalid category, table content, or sequential ID at case ${id}.`);
  }
  cases.push({ id, category, input });
}

if (!cases.length) throw new Error('No user cases found.');
const declaredCount = Number(catalog.match(/\n(\d+) examples of/)?.[1]);
if (declaredCount !== cases.length) throw new Error('Catalog count does not match case rows.');
if (new Set(cases.map(({ input }) => input)).size !== cases.length) {
  throw new Error('Duplicate user inputs found.');
}

const csvCell = (value) => `"${value.replaceAll('"', '""')}"`;
const exports = new Map([
  ['one-sentence-cases.json', `${JSON.stringify(cases, null, 2)}\n`],
  ['one-sentence-cases.csv', `${['id,category,input', ...cases.map((entry) =>
    [entry.id, entry.category, entry.input].map(csvCell).join(','))].join('\r\n')}\r\n`],
]);
const check = process.argv.includes('--check');
const directory = new URL('docs/cases/', root);
if (!check) await mkdir(directory, { recursive: true });
for (const [name, content] of exports) {
  const path = new URL(name, directory);
  if (check) {
    const existing = await readFile(path, 'utf8');
    if (existing.replaceAll('\r\n', '\n') !== content.replaceAll('\r\n', '\n')) {
      throw new Error(`${name} is out of date; run node scripts/export-user-cases.mjs.`);
    }
  } else {
    await writeFile(path, content, 'utf8');
  }
}
console.log(`${check ? 'Verified' : 'Exported'} ${cases.length} unique user cases in ${new Set(cases.map(({ category }) => category)).size} categories.`);
