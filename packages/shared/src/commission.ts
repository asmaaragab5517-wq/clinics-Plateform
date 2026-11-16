import { divRoundHalfUp, type Piastres } from './money';

export type CommissionRule =
  | { kind: 'percent'; percent: number }
  | { kind: 'fixed'; amount: Piastres } // per visit/line
  | { kind: 'tiered'; tiers: { upTo: Piastres | null; percent: number }[] }; // marginal tiers on monthly net revenue

/** Doctor share for a month's lines under one rule (FR-STF-3). `net` excludes VAT. */
export function computeCommission(rule: CommissionRule, lines: { net: Piastres }[]): Piastres {
  const revenue = lines.reduce((a, l) => a + l.net, 0);
  switch (rule.kind) {
    case 'percent':
      return divRoundHalfUp(revenue * Math.round(rule.percent * 100), 10000);
    case 'fixed':
      return rule.amount * lines.length;
    case 'tiered': {
      let remaining = revenue;
      let floor = 0;
      let share = 0;
      for (const t of rule.tiers) {
        const cap = t.upTo === null ? Infinity : t.upTo - floor;
        const portion = Math.min(remaining, cap);
        if (portion <= 0) break;
        share += divRoundHalfUp(portion * Math.round(t.percent * 100), 10000);
        remaining -= portion;
        if (t.upTo !== null) floor = t.upTo;
      }
      return share;
    }
  }
}
