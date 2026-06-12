#!/usr/bin/env node
/**
 * parse-readme.mjs — readme.md -> site/data/tools.json
 *
 * Parses the GitHub-flavored markdown tables in readme.md (Name | Description | Link | Price)
 * into the JSON consumed by the site. The readme stays the single source of truth:
 * never hand-edit site/data/tools.json.
 *
 * Run from anywhere: node scripts/parse-readme.mjs
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = path.join(ROOT, 'readme.md');
const OUT = path.join(ROOT, 'site', 'data', 'tools.json');

// Column layout is read from each table's header row, so reordering columns
// in the readme is safe; this is the fallback when a table has no header.
const DEFAULT_COLUMNS = ['name', 'description', 'link', 'price'];

/** Title-case a heading, keeping small connector words lowercase (except first word). */
function titleCaseCategory(raw) {
  const small = new Set(['and', 'or', 'of', 'the', 'in', 'for', 'a', 'an', 'to']);
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** Convert inline markdown to plain text: [text](url) -> text, <url> -> url, strip backticks. */
function plainText(md) {
  return md
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract the FIRST http(s) URL from a cell, ignoring any surrounding prose or extra links. */
function extractUrl(cell) {
  const match = cell.match(/https?:\/\/[^\s<>()|\]]+/);
  if (!match) return null;
  // Trim punctuation that belongs to the prose, not the URL.
  return match[0].replace(/[.,;:]+$/, '');
}

/** Normalize Free / Paid / Free/Paid / Free/paid -> free | paid | freemium. */
function normalizePrice(cell) {
  const value = cell.trim().toLowerCase();
  const hasFree = value.includes('free');
  const hasPaid = value.includes('paid');
  if (hasFree && hasPaid) return 'freemium';
  if (hasPaid) return 'paid';
  if (hasFree) return 'free';
  return null;
}

/** URL-safe slug: lowercase, alphanumerics and hyphens only. */
function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Deterministic 2-digit TV channel (1-99) derived from the slug. */
function channelFor(slug) {
  let hash = 0;
  for (const char of slug) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return (hash % 99) + 1;
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function isHeaderRow(cells) {
  return cells[0].trim().toLowerCase() === 'name';
}

function splitRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|');
}

async function main() {
  const markdown = await readFile(README, 'utf8');
  const lines = markdown.split(/\r?\n/);

  const categoryOrder = []; // display names, in order of first appearance
  /** @type {Map<string, Map<string, object>>} category -> (normalized tool name -> tool) */
  const byCategory = new Map();
  let currentCategory = null;
  let columns = DEFAULT_COLUMNS; // per-table column order, read from its header row
  let warnings = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      currentCategory = titleCaseCategory(heading[1]);
      columns = DEFAULT_COLUMNS;
      continue;
    }

    if (!currentCategory || !line.trim().startsWith('|')) continue;

    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;
    if (isHeaderRow(cells)) {
      columns = cells.map((cell) => cell.trim().toLowerCase());
      continue;
    }
    if (cells.length !== columns.length) {
      console.warn(`warn: skipping malformed row (${cells.length} columns, expected ${columns.length}) at readme.md:${i + 1}: ${line.trim().slice(0, 80)}`);
      warnings++;
      continue;
    }

    const cell = (column) => cells[columns.indexOf(column)] ?? '';
    const name = plainText(cell('name'));
    const description = plainText(cell('description'));
    const url = extractUrl(cell('link'));
    const price = normalizePrice(cell('price'));

    if (!name) {
      console.warn(`warn: skipping row with empty name at readme.md:${i + 1}`);
      warnings++;
      continue;
    }
    if (!url) {
      console.warn(`warn: skipping "${name}" — no http(s) URL found in link column (readme.md:${i + 1})`);
      warnings++;
      continue;
    }
    if (!price) {
      console.warn(`warn: skipping "${name}" — unrecognized price "${cells[3].trim()}" (readme.md:${i + 1})`);
      warnings++;
      continue;
    }

    if (!byCategory.has(currentCategory)) {
      byCategory.set(currentCategory, new Map());
      categoryOrder.push(currentCategory);
    }
    const bucket = byCategory.get(currentCategory);

    // Dedupe within a category by normalized name (handles the duplicated
    // "Accessibility Testing Tools" sections); keep the longer description.
    const key = name.trim().toLowerCase();
    const existing = bucket.get(key);
    if (existing) {
      if (description.length > existing.description.length) {
        bucket.set(key, { name, description, url, price, category: currentCategory });
      }
      continue;
    }
    bucket.set(key, { name, description, url, price, category: currentCategory });
  }

  // Assemble: categories in readme order, tools alphabetical within each category.
  const usedIds = new Set();
  const tools = [];
  for (const category of categoryOrder) {
    const entries = [...byCategory.get(category).values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    );
    for (const entry of entries) {
      // Same tool may legitimately appear in two categories; keep ids globally unique.
      let id = slugify(entry.name) || 'tool';
      let suffix = 2;
      while (usedIds.has(id)) id = `${slugify(entry.name)}-${suffix++}`;
      usedIds.add(id);
      tools.push({
        id,
        name: entry.name,
        description: entry.description,
        url: entry.url,
        price: entry.price,
        category: entry.category,
        channel: channelFor(id),
      });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    categories: categoryOrder,
    tools,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(
    `Parsed ${tools.length} tools across ${categoryOrder.length} categories` +
      (warnings ? ` (${warnings} row(s) skipped with warnings)` : '') +
      ` -> ${path.relative(ROOT, OUT)}`
  );
}

main().catch((error) => {
  console.error('parse-readme failed:', error);
  process.exit(1);
});
