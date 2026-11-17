/**
 * Reference data import (D10 drug list, drug interactions, ICD-10 with Arabic titles).
 * Usage: node dist/import-reference-cli.js <drugs|interactions|icd10> <file.csv> [--dry-run]
 * CSV with a header row; UTF-8 (BOM allowed). Rows are validated first; nothing is written if any row is invalid.
 *   drugs:        trade_name_en,trade_name_ar,active_ingredients (separated by +),strength,form,manufacturer,price_egp
 *   interactions: ingredient_a,ingredient_b,severity (minor|moderate|major|contraindicated),description_en,description_ar
 *   icd10:        code,title_en,title_ar
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { parseCsvRecords } from './csv';

type Kind = 'drugs' | 'interactions' | 'icd10';

export function validate(kind: Kind, rows: Record<string, string>[]): { errors: string[]; values: unknown[][] } {
  const errors: string[] = [];
  const values: unknown[][] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    if (kind === 'drugs') {
      const ing = (r.active_ingredients ?? '').split('+').map((x) => x.trim().toLowerCase()).filter(Boolean);
      const price = r.price_egp ? Math.round(Number(r.price_egp) * 100) : null;
      if (!r.trade_name_en) errors.push(`${line}: trade_name_en required`);
      if (!ing.length) errors.push(`${line}: active_ingredients required`);
      if (price !== null && !Number.isFinite(price)) errors.push(`${line}: invalid price_egp`);
      values.push([r.trade_name_en, r.trade_name_ar || null, ing, r.strength || null, r.form || null, r.manufacturer || null, price]);
    } else if (kind === 'interactions') {
      const [a, b] = [r.ingredient_a, r.ingredient_b].map((x) => (x ?? '').trim().toLowerCase()).sort() as [string, string];
      if (!a || !b || a === b) errors.push(`${line}: two different ingredients required`);
      if (!['minor', 'moderate', 'major', 'contraindicated'].includes(r.severity ?? '')) errors.push(`${line}: invalid severity`);
      if (!r.description_en) errors.push(`${line}: description_en required`);
      values.push([a, b, r.severity, r.description_en, r.description_ar || null]);
    } else {
      if (!/^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/.test(r.code ?? '')) errors.push(`${line}: invalid ICD-10 code ${r.code}`);
      if (!r.title_en) errors.push(`${line}: title_en required`);
      values.push([r.code, r.title_en, r.title_ar || null]);
    }
  });
  return { errors, values };
}

export async function importReference(adminUrl: string, kind: Kind, csv: string, opts: { dryRun?: boolean; source?: string } = {}) {
  const rows = parseCsvRecords(csv);
  const { errors, values } = validate(kind, rows);
  if (errors.length || opts.dryRun) return { rows: rows.length, errors, written: 0 };
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query('begin');
    const source = opts.source ?? 'import';
    for (const v of values) {
      if (kind === 'drugs') {
        await c.query(
          `insert into drugs (trade_name_en, trade_name_ar, active_ingredients, strength, form, manufacturer, price, source) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [...v, source],
        );
      } else if (kind === 'interactions') {
        await c.query(
          `insert into drug_interactions (ingredient_a, ingredient_b, severity, description_en, description_ar, source) values ($1,$2,$3,$4,$5,$6)
           on conflict (ingredient_a, ingredient_b) do update set severity = excluded.severity, description_en = excluded.description_en, description_ar = excluded.description_ar, source = excluded.source`,
          [...v, source],
        );
      } else {
        await c.query(`insert into icd10_codes (code, title_en, title_ar) values ($1,$2,$3) on conflict (code) do update set title_en = excluded.title_en, title_ar = coalesce(excluded.title_ar, icd10_codes.title_ar)`, v);
      }
    }
    await c.query('commit');
    return { rows: rows.length, errors, written: values.length };
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  const [kind, file] = process.argv.slice(2) as [Kind, string];
  if (!['drugs', 'interactions', 'icd10'].includes(kind) || !file) {
    console.error('usage: import-reference-cli <drugs|interactions|icd10> <file.csv> [--dry-run] [--source=<name>]');
    process.exit(2);
  }
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is required');
  const source = process.argv.find((a) => a.startsWith('--source='))?.slice(9);
  importReference(url, kind, readFileSync(file, 'utf8'), { dryRun: process.argv.includes('--dry-run'), source })
    .then((r) => {
      for (const e of r.errors.slice(0, 50)) console.error(e);
      console.log(JSON.stringify({ rows: r.rows, errors: r.errors.length, written: r.written }));
      process.exit(r.errors.length ? 1 : 0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
