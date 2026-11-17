import { HttpStatus } from '@nestjs/common';
import type { Tx } from '@hf/db';
import { DomainError } from '../common/errors';

interface FieldDef {
  key: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean' | 'file';
  options: { value: string }[];
  required: boolean;
  validation: { min?: number; max?: number; pattern?: string };
}

/**
 * Checks patient custom-field values against the organisation's definitions (FR-PAT custom fields).
 * Unknown keys, wrong types, values outside options or bounds, and (on create) missing required fields are rejected
 * with 422 `invalid_custom_fields` listing each problem by key. `null` clears an optional field. Portal self-registration
 * uses 'update' mode because patients never see staff-defined fields, so required ones are enforced at staff registration only.
 */
export async function validateCustomFields(tx: Tx, values: Record<string, unknown> | undefined, mode: 'create' | 'update') {
  const defs = await tx.query<FieldDef>(`select key, type, options, required, validation from custom_field_defs where entity = 'patient'`);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const problems: { key: string; error: string }[] = [];
  const v = values ?? {};
  for (const [key, value] of Object.entries(v)) {
    const d = byKey.get(key);
    if (!d) {
      problems.push({ key, error: 'unknown_field' });
      continue;
    }
    if (value === null || value === '') {
      if (d.required) problems.push({ key, error: 'required' });
      continue;
    }
    const err = checkValue(d, value);
    if (err) problems.push({ key, error: err });
  }
  if (mode === 'create') for (const d of defs) if (d.required && (v[d.key] === undefined || v[d.key] === null || v[d.key] === '')) problems.push({ key: d.key, error: 'required' });
  if (problems.length) throw new DomainError('invalid_custom_fields', HttpStatus.UNPROCESSABLE_ENTITY, problems);
}

function checkValue(d: FieldDef, value: unknown): string | null {
  const { min, max, pattern } = d.validation ?? {};
  const allowed = new Set((d.options ?? []).map((o) => o.value));
  switch (d.type) {
    case 'text': {
      if (typeof value !== 'string' || value.length > 1000) return 'expected_text';
      if (min !== undefined && value.length < min) return 'too_short';
      if (max !== undefined && value.length > max) return 'too_long';
      if (pattern) {
        let re: RegExp;
        try {
          re = new RegExp(`^(?:${pattern})$`, 'u');
        } catch {
          return null; // an invalid admin pattern must not block registration
        }
        if (!re.test(value)) return 'pattern_mismatch';
      }
      return null;
    }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'expected_number';
      if (min !== undefined && value < min) return 'below_min';
      if (max !== undefined && value > max) return 'above_max';
      return null;
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? null : 'expected_date';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected_boolean';
    case 'select':
      return typeof value === 'string' && allowed.has(value) ? null : 'not_an_option';
    case 'multiselect':
      return Array.isArray(value) && value.length <= 50 && value.every((x) => typeof x === 'string' && allowed.has(x)) ? null : 'not_an_option';
    case 'file': {
      const f = value as { documentId?: unknown; name?: unknown };
      return typeof f === 'object' && typeof f.documentId === 'string' && /^[0-9a-f-]{36}$/i.test(f.documentId) && typeof f.name === 'string' && f.name.length <= 255 ? null : 'expected_file';
    }
  }
}
