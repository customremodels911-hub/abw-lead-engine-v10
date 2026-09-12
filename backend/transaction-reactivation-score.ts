// V10 Transaction Reactivation Score
// Isolated scoring module. It is intentionally NOT imported by the live runtime yet.
// Never persist raw bank/Venmo transaction data or customer PII in source control.

export type TransactionReactivationInput = {
  totalPaid: number;
  paymentCount: number;
  daysSinceLastPayment: number;
  hasClearProjectMemo: boolean;
  hasInvoiceReference?: boolean;
  isKnownRetailCustomer?: boolean;
  isB2BRelationship?: boolean;
  isAmbiguousRelationship?: boolean;
  isFriendFavor?: boolean;
  isPersonalFamily?: boolean;
  expansionPotential?: 'high' | 'medium' | 'low' | 'unknown';
};

export type TransactionReactivationScore = {
  score: number;
  tier: 'A' | 'B' | 'C' | 'DO_NOT_CONTACT';
  reasons: string[];
};

export function scoreTransactionReactivation(input: TransactionReactivationInput): TransactionReactivationScore {
  if (input.isFriendFavor || input.isPersonalFamily) {
    return {
      score: 0,
      tier: 'DO_NOT_CONTACT',
      reasons: [input.isFriendFavor ? 'friend/favor relationship' : 'personal/family money movement'],
    };
  }

  let score = 0;
  const reasons: string[] = [];

  // 1. Proven spend / economic value: max 20
  if (input.totalPaid >= 5000) { score += 20; reasons.push('very high proven spend'); }
  else if (input.totalPaid >= 2500) { score += 18; reasons.push('high proven spend'); }
  else if (input.totalPaid >= 1500) { score += 16; reasons.push('strong proven spend'); }
  else if (input.totalPaid >= 1000) { score += 14; reasons.push('meaningful proven spend'); }
  else if (input.totalPaid >= 750) { score += 12; reasons.push('solid proven spend'); }
  else if (input.totalPaid >= 500) { score += 10; reasons.push('moderate proven spend'); }
  else if (input.totalPaid >= 250) { score += 7; reasons.push('small but real spend'); }
  else { score += 2; reasons.push('low historical spend'); }

  // 2. Repeat-payment behavior: max 20
  if (input.paymentCount >= 4) { score += 20; reasons.push('multiple repeat payments'); }
  else if (input.paymentCount === 3) { score += 17; reasons.push('three payments'); }
  else if (input.paymentCount === 2) { score += 13; reasons.push('repeat payer'); }
  else { score += 6; reasons.push('single payment'); }

  // 3. Recency: max 15
  if (input.daysSinceLastPayment <= 90) { score += 15; reasons.push('very recent relationship'); }
  else if (input.daysSinceLastPayment <= 180) { score += 12; reasons.push('recent relationship'); }
  else if (input.daysSinceLastPayment <= 365) { score += 9; reasons.push('relationship within one year'); }
  else if (input.daysSinceLastPayment <= 730) { score += 5; reasons.push('older but still actionable'); }
  else { score += 1; reasons.push('stale relationship'); }

  // 4. Transaction evidence quality: max 20
  if (input.hasClearProjectMemo) { score += 15; reasons.push('project-specific payment memo'); }
  if (input.hasInvoiceReference) { score += 5; reasons.push('invoice-linked payment'); }
  if (!input.hasClearProjectMemo && !input.hasInvoiceReference) {
    score += 4;
    reasons.push('weak project context');
  }

  // 5. Relationship quality: max 10
  if (input.isKnownRetailCustomer) { score += 10; reasons.push('known retail customer'); }
  else if (input.isB2BRelationship) { score += 9; reasons.push('repeat B2B/referral relationship'); }
  else if (input.isAmbiguousRelationship) { score -= 8; reasons.push('relationship needs verification'); }
  else { score += 3; reasons.push('relationship not yet classified'); }

  // 6. Expansion / adjacent-project potential: max 15
  if (input.expansionPotential === 'high') { score += 15; reasons.push('high adjacent-project potential'); }
  else if (input.expansionPotential === 'medium') { score += 10; reasons.push('medium adjacent-project potential'); }
  else if (input.expansionPotential === 'low') { score += 4; reasons.push('limited adjacent-project potential'); }
  else { score += 6; reasons.push('expansion potential not yet known'); }

  score = Math.max(0, Math.min(100, score));
  const tier: TransactionReactivationScore['tier'] = score >= 75 ? 'A' : score >= 55 ? 'B' : 'C';
  return { score, tier, reasons };
}
