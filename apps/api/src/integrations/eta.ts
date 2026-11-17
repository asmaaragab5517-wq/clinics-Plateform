import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CONFIG, type Config } from '../config';

export interface EtaCredentials {
  clientId: string;
  clientSecret: string;
  posSerial: string;
  posOsVersion: string;
  presharedKey: string;
  rin: string;
  branchCode: string;
  activityCode: string;
  companyTradeName: string;
  address: { governate: string; regionCity: string; street: string; buildingNumber: string };
}
export interface EtaSubmitResult {
  submissionId: string;
  accepted: { uuid: string; receiptNumber: string }[];
  rejected: { receiptNumber: string; error: unknown }[];
}
/** ETA e-receipt API adapter (FR-BIL-10). Paths per the ETA e-receipt API; confirm during onboarding. */
export interface EtaClient {
  submit(creds: EtaCredentials, mode: 'preprod' | 'prod', receipts: unknown[]): Promise<EtaSubmitResult>;
}
export const ETA = Symbol('ETA');

@Injectable()
export class HttpEtaClient implements EtaClient {
  private tokens = new Map<string, { value: string; exp: number }>();
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  private hosts(mode: 'preprod' | 'prod') {
    return mode === 'prod' ? { id: 'https://id.eta.gov.eg', api: 'https://api.invoicing.eta.gov.eg' } : { id: 'https://id.preprod.eta.gov.eg', api: 'https://api.preprod.invoicing.eta.gov.eg' };
  }

  private async token(c: EtaCredentials, mode: 'preprod' | 'prod') {
    const key = `${mode}:${c.clientId}`;
    const cur = this.tokens.get(key);
    if (cur && cur.exp > Date.now() + 60_000) return cur.value;
    const res = await fetch(`${this.hosts(mode).id}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', posserial: c.posSerial, pososversion: c.posOsVersion, presharedkey: c.presharedKey },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`eta_token_${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.tokens.set(key, { value: j.access_token, exp: Date.now() + j.expires_in * 1000 });
    return j.access_token;
  }

  async submit(c: EtaCredentials, mode: 'preprod' | 'prod', receipts: unknown[]): Promise<EtaSubmitResult> {
    const res = await fetch(`${this.hosts(mode).api}/api/v1/receiptsubmissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.token(c, mode)}` },
      body: JSON.stringify({ receipts }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.status >= 500 || res.status === 429) throw new Error(`eta_submit_${res.status}`);
    const j = (await res.json()) as { submissionId?: string; acceptedDocuments?: { uuid: string; receiptNumber: string }[]; rejectedDocuments?: { receiptNumber: string; error: unknown }[] };
    return { submissionId: j.submissionId ?? '', accepted: j.acceptedDocuments ?? [], rejected: j.rejectedDocuments ?? [] };
  }
}

@Injectable()
export class FakeEtaClient implements EtaClient {
  readonly submissions: unknown[][] = [];
  failNext = 0;
  async submit(_c: EtaCredentials, _m: 'preprod' | 'prod', receipts: unknown[]): Promise<EtaSubmitResult> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('eta_submit_503');
    }
    this.submissions.push(receipts);
    return {
      submissionId: randomUUID(),
      accepted: (receipts as { header: { uuid: string; receiptNumber: string } }[]).map((r) => ({ uuid: r.header.uuid, receiptNumber: r.header.receiptNumber })),
      rejected: [],
    };
  }
}
