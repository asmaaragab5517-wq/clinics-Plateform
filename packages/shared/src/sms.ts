const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€\f';

export interface SmsSegments {
  encoding: 'GSM-7' | 'UCS-2';
  units: number;
  segments: number;
  perSegment: number;
}

/** Count SMS segments (FR-COM-2): GSM-7 160/153, UCS-2 (Arabic) 70/67. */
export function smsSegments(text: string): SmsSegments {
  let gsm = true;
  let units = 0;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const segments = units <= 160 ? 1 : Math.ceil(units / 153);
    return { encoding: 'GSM-7', units, segments, perSegment: segments === 1 ? 160 : 153 };
  }
  const u = text.length; // UTF-16 code units
  const segments = u <= 70 ? 1 : Math.ceil(u / 67);
  return { encoding: 'UCS-2', units: u, segments, perSegment: segments === 1 ? 70 : 67 };
}

/** Render a template with typed {{variables}}; unknown variables throw. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => {
    if (!(k in vars)) throw new Error(`Missing template variable: ${k}`);
    return String(vars[k]);
  });
}

export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!))];
}

/** Quiet hours 22:00–09:00 Cairo for non-urgent messages (FR-COM-4). */
export function inQuietHours(localHHmm: string, start = '22:00', end = '09:00'): boolean {
  return start > end ? localHHmm >= start || localHHmm < end : localHHmm >= start && localHHmm < end;
}
