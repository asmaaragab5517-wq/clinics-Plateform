import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import { CONFIG, type Config } from '../config';

export const AI_MODEL = 'claude-opus-5-5';
export const PROMPT_VERSION = '2026-11-17.1';

// ---- Output schemas (structured outputs). Clinical content must come only from the input.
export const encounterDraftSchema = z.object({
  chiefComplaint: z.string(),
  hpi: z.string(),
  examination: z.string(),
  notes: z.string(),
  vitals: z.object({
    systolic: z.number().nullable(), diastolic: z.number().nullable(), heartRate: z.number().nullable(), temperatureC: z.number().nullable(),
    respiratoryRate: z.number().nullable(), spo2: z.number().nullable(), weightKg: z.number().nullable(), heightCm: z.number().nullable(),
  }),
  diagnoses: z.array(z.object({ code: z.string(), title: z.string(), stated: z.boolean() })),
  followUpInDays: z.number().nullable(),
  missingInformation: z.array(z.string()),
});
export const patientSummarySchema = z.object({ summaryAr: z.string(), summaryEn: z.string() });
export const rxInstructionsSchema = z.object({ lines: z.array(z.object({ index: z.number(), instructionsAr: z.string(), instructionsEn: z.string() })) });

export type EncounterDraft = z.infer<typeof encounterDraftSchema>;
export type PatientSummaryDraft = z.infer<typeof patientSummarySchema>;
export type RxInstructionsDraft = z.infer<typeof rxInstructionsSchema>;

export interface AiResult<T> {
  output: T;
  model: string;
  servedModel: string;
  inputTokens: number;
  outputTokens: number;
}

export class AiDeclinedError extends Error {}

/** Clinical drafting assistant. Implementations never write to the record; callers store drafts for doctor approval. */
export interface AiClient {
  draftEncounter(input: { transcript: string; specialty: string | null; ageYears: number; sex: string; locale: 'ar' | 'en' }): Promise<AiResult<EncounterDraft>>;
  patientSummary(input: { encounter: Record<string, unknown>; medications: string[]; ageYears: number; sex: string }): Promise<AiResult<PatientSummaryDraft>>;
  rxInstructions(input: { lines: { index: number; drug: string; dose: string; route: string; frequency: string; durationDays: number | null }[] }): Promise<AiResult<RxInstructionsDraft>>;
}
export const AI = Symbol('AI');

/** Speech-to-text for dictation audio (Arabic/English). Configurable endpoint so audio can stay in-region (D1). */
export interface SttProvider {
  transcribe(audio: Buffer, mime: string, language: 'ar' | 'en' | 'auto'): Promise<string>;
}
export const STT = Symbol('STT');

const SYSTEM_ENCOUNTER = `You are a clinical documentation assistant for an outpatient clinic in Egypt. You turn a doctor's dictation (Arabic, English, or a mix of both, often with Egyptian colloquial phrasing) into a draft of the visit record. The doctor reviews and edits every draft before anything is saved, so accuracy matters more than completeness.

Rules:
- Use only what the dictation states. Do not add findings, history, diagnoses, doses or advice that the doctor did not say. If a field was not dictated, return an empty string (or null for numbers).
- Keep each field in the language the doctor used for it. Use standard medical terms; keep drug names and lab values exactly as dictated.
- diagnoses: list only diagnoses the doctor named. Give the most specific ICD-10 code you are confident in and its English title; set stated=true. If you cannot map a stated diagnosis confidently, leave the code empty rather than guess.
- vitals: numbers in the units given (blood pressure mmHg, temperature °C, weight kg, height cm); null when not dictated.
- followUpInDays: only if the doctor stated a follow-up interval.
- missingInformation: short notes on anything a reviewing doctor would expect but the dictation left unclear (for example "dose of the antibiotic not stated"). Do not invent requirements.`;

const SYSTEM_SUMMARY = `You write short visit summaries for patients of an Egyptian outpatient clinic. The doctor reviews the summary before the patient sees it.

Write summaryAr in clear Modern Standard Arabic that a patient without medical training understands (aim for 80-150 words), and summaryEn as an equivalent English version. Explain what was found, the diagnosis in plain words, the medicines and how to take them, and when to come back - using only the information in the record provided. Do not add new diagnoses, tests, doses or advice, and do not change any dose, frequency or duration. If the record mentions warning signs, include them; do not invent them.`;

const SYSTEM_RX = `You write patient instructions for prescription lines at an Egyptian clinic. The doctor reviews them before the prescription is issued.

For each line, write instructionsAr in simple Egyptian-friendly Modern Standard Arabic (for example «قرص مرتين يوميًا بعد الأكل لمدة ٥ أيام») and instructionsEn in plain English. Keep the dose, route, frequency and duration exactly as given - never change, round or add to them, and do not add warnings or advice that are not implied by the line itself. Return one entry per input line with the same index.`;

@Injectable()
export class AnthropicAiClient implements AiClient {
  private readonly client: Anthropic;
  private readonly log = new Logger('AI');
  constructor(@Inject(CONFIG) private readonly cfg: Config) {
    // Credentials resolve from ANTHROPIC_API_KEY (or another configured credential source).
    this.client = new Anthropic({ timeout: 120_000, maxRetries: 2 });
  }

  private async run<T extends z.ZodType>(system: string, user: string, schema: T): Promise<AiResult<z.infer<T>>> {
    const res = await this.client.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: zodOutputFormat(schema) },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') throw new AiDeclinedError(res.stop_details?.category ?? 'refusal');
    if (res.stop_reason === 'max_tokens' || !res.parsed_output) throw new Error('ai_incomplete_output');
    return { output: res.parsed_output as z.infer<T>, model: AI_MODEL, servedModel: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }

  draftEncounter(i: Parameters<AiClient['draftEncounter']>[0]) {
    const user = `Patient: ${i.sex}, ${i.ageYears} years. Clinic specialty: ${i.specialty ?? 'general'}. Preferred record language: ${i.locale === 'ar' ? 'Arabic' : 'English'}.\n\n<dictation>\n${i.transcript}\n</dictation>`;
    return this.run(SYSTEM_ENCOUNTER, user, encounterDraftSchema);
  }

  patientSummary(i: Parameters<AiClient['patientSummary']>[0]) {
    const user = `Patient: ${i.sex}, ${i.ageYears} years.\n\n<visit_record>\n${JSON.stringify(i.encounter, null, 2)}\n</visit_record>\n\n<medications>\n${i.medications.join('\n') || 'none'}\n</medications>`;
    return this.run(SYSTEM_SUMMARY, user, patientSummarySchema);
  }

  rxInstructions(i: Parameters<AiClient['rxInstructions']>[0]) {
    return this.run(SYSTEM_RX, `<prescription_lines>\n${JSON.stringify(i.lines, null, 2)}\n</prescription_lines>`, rxInstructionsSchema);
  }
}

/** Deterministic stand-in for development and tests (no external calls). */
@Injectable()
export class FakeAiClient implements AiClient {
  calls: { kind: string; input: unknown }[] = [];
  async draftEncounter(i: Parameters<AiClient['draftEncounter']>[0]) {
    this.calls.push({ kind: 'encounter', input: i });
    const bp = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(i.transcript);
    return {
      output: {
        chiefComplaint: i.transcript.split(/[.،\n]/)[0] ?? '', hpi: '', examination: '', notes: i.transcript,
        vitals: { systolic: bp ? Number(bp[1]) : null, diastolic: bp ? Number(bp[2]) : null, heartRate: null, temperatureC: null, respiratoryRate: null, spo2: null, weightKg: null, heightCm: null },
        diagnoses: /ضغط|hypertension/i.test(i.transcript) ? [{ code: 'I10', title: 'Essential (primary) hypertension', stated: true }, { code: 'X99.9', title: 'Invented', stated: true }] : [],
        followUpInDays: /أسبوعين|two weeks/i.test(i.transcript) ? 14 : null,
        missingInformation: [],
      },
      model: AI_MODEL, servedModel: AI_MODEL, inputTokens: 100, outputTokens: 50,
    };
  }
  async patientSummary(i: Parameters<AiClient['patientSummary']>[0]) {
    this.calls.push({ kind: 'summary', input: i });
    return { output: { summaryAr: 'ملخص الزيارة للمريض.', summaryEn: 'Visit summary for the patient.' }, model: AI_MODEL, servedModel: AI_MODEL, inputTokens: 80, outputTokens: 40 };
  }
  async rxInstructions(i: Parameters<AiClient['rxInstructions']>[0]) {
    this.calls.push({ kind: 'rx', input: i });
    return {
      output: { lines: i.lines.map((l) => ({ index: l.index, instructionsAr: `${l.dose} ${l.frequency}${l.durationDays ? ` لمدة ${l.durationDays} يوم` : ''}`, instructionsEn: `${l.dose}, ${l.frequency}${l.durationDays ? ` for ${l.durationDays} days` : ''}` })) },
      model: AI_MODEL, servedModel: AI_MODEL, inputTokens: 60, outputTokens: 30,
    };
  }
}

/** OpenAI-compatible /audio/transcriptions endpoint (e.g. a self-hosted Whisper server in-region). */
@Injectable()
export class HttpSttProvider implements SttProvider {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}
  async transcribe(audio: Buffer, mime: string, language: 'ar' | 'en' | 'auto') {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), 'dictation');
    form.append('model', this.cfg.STT_MODEL);
    if (language !== 'auto') form.append('language', language);
    const res = await fetch(`${this.cfg.STT_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: this.cfg.STT_API_KEY ? { authorization: `Bearer ${this.cfg.STT_API_KEY}` } : {},
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`stt_${res.status}`);
    return ((await res.json()) as { text: string }).text;
  }
}

@Injectable()
export class FakeSttProvider implements SttProvider {
  async transcribe(audio: Buffer) {
    return audio.toString('utf8').replace(/^FAKEAUDIO:/, '');
  }
}
