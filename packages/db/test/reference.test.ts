import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { importReference } from '../src/import-reference-cli';
import { createTestDatabase } from '../../testkit/src';

let env: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  env = await createTestDatabase('hf_test_db_reference');
}, 60000);
afterAll(async () => env?.drop());

describe('reference data import (D10)', () => {
  it('validates the whole file before writing anything', async () => {
    const r = await importReference(env.adminUrl, 'drugs', 'trade_name_en,active_ingredients\nGood,paracetamol\n,missing\n');
    expect(r.errors).toEqual(["3: trade_name_en required"]);
    expect(r.written).toBe(0);
  });
  it('imports drugs, interactions (pairs normalised) and ICD-10 with Arabic titles', async () => {
    const d = await importReference(env.adminUrl, 'drugs', '﻿trade_name_en,trade_name_ar,active_ingredients,strength,form,manufacturer,price_egp\nMarevan,ماريفان,Warfarin,5 mg,tablet,X,"45.50"\n', { source: 'test-list' });
    expect(d).toMatchObject({ errors: [], written: 1 });
    const i = await importReference(env.adminUrl, 'interactions', 'ingredient_a,ingredient_b,severity,description_en,description_ar\nwarfarin,Ibuprofen,major,Bleeding risk,خطر النزيف\n');
    expect(i.written).toBe(1);
    const c = await importReference(env.adminUrl, 'icd10', 'code,title_en,title_ar\nK35.80,"Acute appendicitis, other",التهاب الزائدة الحاد\nbad,x,y\n');
    expect(c.errors).toEqual(['3: invalid ICD-10 code bad']);
    const db = new Client({ connectionString: env.adminUrl });
    await db.connect();
    expect((await db.query(`select price, active_ingredients from drugs where trade_name_en = 'Marevan'`)).rows[0]).toEqual({ price: 4550, active_ingredients: ['warfarin'] });
    expect((await db.query(`select severity from drug_interactions where ingredient_a = 'ibuprofen' and ingredient_b = 'warfarin'`)).rows[0].severity).toBe('major');
    await db.end();
  });
});
