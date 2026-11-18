import { formatDate, formatMoney, formatTime12, type Locale } from '@hf/shared';
import { esc, page } from './html';

export interface ClinicHeader {
  nameAr: string;
  nameEn: string;
  address: string;
  phones: string[];
  logoDataUrl?: string | null;
}

const header = (c: ClinicHeader, right: string) => `
<div class="header">
  <div>${c.logoDataUrl ? `<img src="${c.logoDataUrl}" style="max-height:48px">` : ''}
    <h2>${esc(c.nameAr)}</h2><div class="muted ltr">${esc(c.nameEn)}</div>
    <div class="muted">${esc(c.address)} · <span class="ltr">${c.phones.map(esc).join(' / ')}</span></div></div>
  <div style="text-align:end">${right}</div>
</div>`;

const DOCTOR_TITLE: Record<string, { ar: string; en: string }> = {
  prof: { ar: 'أ.د', en: 'Prof.' },
  dr: { ar: 'د', en: 'Dr.' },
  consultant: { ar: 'استشاري', en: 'Consultant' },
  specialist: { ar: 'أخصائي', en: 'Specialist' },
};

export interface PrescriptionDoc {
  clinic: ClinicHeader;
  doctor: { nameAr: string; nameEn: string; title: string; specialtyAr: string; specialtyEn: string; syndicateNumber: string; signatureDataUrl?: string | null; stampDataUrl?: string | null };
  patient: { name: string; ageYears: number; mrn: string };
  issuedAt: Date;
  lines: { drug: string; dose: string; route: string; frequency: string; durationDays?: number | null; quantity?: string | null; instructionsAr: string; instructionsEn: string }[];
  notes?: string | null;
  qrDataUrl: string;
  verifyUrl: string;
  size?: 'A4' | 'A5';
}

/** Bilingual RTL prescription (FR-RX-5). */
export function prescriptionHtml(d: PrescriptionDoc): string {
  const t = DOCTOR_TITLE[d.doctor.title] ?? DOCTOR_TITLE.dr!;
  const body = `
${header(d.clinic, `<b>${esc(t.ar)} / ${esc(d.doctor.nameAr)}</b><div class="ltr muted">${esc(t.en)} ${esc(d.doctor.nameEn)}</div>
  <div class="muted">${esc(d.doctor.specialtyAr)} · <span class="ltr">${esc(d.doctor.specialtyEn)}</span></div>
  <div class="muted">رقم النقابة / Syndicate No. <span class="ltr">${esc(d.doctor.syndicateNumber)}</span></div>`)}
<div class="row"><div>المريض / Patient: <b>${esc(d.patient.name)}</b></div><div>السن / Age: <span class="ltr">${d.patient.ageYears}</span></div>
<div>رقم الملف / MRN: <span class="ltr">${esc(d.patient.mrn)}</span></div><div>التاريخ / Date: <span class="ltr">${formatDate(d.issuedAt)}</span></div></div>
<h1 style="margin-block:8px" class="ltr">℞</h1>
${d.lines
  .map(
    (l, i) => `<div class="rx-line"><div><span class="ltr">${i + 1}.</span> <b class="ltr">${esc(l.drug)}</b></div>
  <div>${esc(l.instructionsAr || `${l.dose} - ${l.frequency}`)}${l.durationDays ? ` لمدة ${l.durationDays} يوم` : ''}</div>
  <div class="ltr muted">${esc(l.instructionsEn || `${l.dose}, ${l.route}, ${l.frequency}`)}${l.durationDays ? ` for ${l.durationDays} days` : ''}${l.quantity ? ` · Qty ${esc(l.quantity)}` : ''}</div></div>`,
  )
  .join('')}
${d.notes ? `<p>${esc(d.notes)}</p>` : ''}
<div class="sig">
  <div>${d.doctor.signatureDataUrl ? `<img src="${d.doctor.signatureDataUrl}" alt="signature">` : ''}<div class="muted">التوقيع / Signature</div></div>
  <div>${d.doctor.stampDataUrl ? `<img src="${d.doctor.stampDataUrl}" alt="stamp">` : ''}<div class="muted">الختم / Stamp</div></div>
  <div style="margin-inline-start:auto;text-align:center"><img src="${d.qrDataUrl}" style="width:90px;height:90px"><div class="muted ltr">${esc(d.verifyUrl)}</div></div>
</div>`;
  return page({ title: 'Prescription', size: d.size ?? 'A5', body });
}

export interface InvoiceDoc {
  kind: 'invoice' | 'receipt';
  locale: Locale;
  clinic: ClinicHeader;
  legalEntity: { nameAr: string; nameEn: string; taxRegistrationNumber?: string | null; commercialRegister?: string | null };
  number: string;
  issuedAt: Date;
  patient: { name: string; mrn: string };
  lines: { description: string; qty: number; unitPrice: number; discount: number; vat: number; total: number }[];
  totals: { subtotal: number; discount: number; vat: number; total: number; paid: number; balance: number };
  payments?: { method: string; amount: number; receiptNumber?: string | null; at: Date }[];
  footer?: string;
  /** ETA e-receipt QR (data URL) and UUID when the receipt was submitted (FR-BIL-10). */
  eta?: { qrDataUrl: string; uuid: string } | null;
}

/** Invoice / receipt in Arabic with optional English (FR-BIL-8). */
export function invoiceHtml(d: InvoiceDoc): string {
  const m = (p: number) => formatMoney(p, 'ar');
  const title = d.kind === 'invoice' ? 'فاتورة / Invoice' : 'إيصال استلام / Receipt';
  const body = `
${header(d.clinic, `<h2>${title}</h2><div class="ltr">${esc(d.number)}</div><div class="muted ltr">${formatDate(d.issuedAt)} ${formatTime12(d.issuedAt, 'en')}</div>`)}
<div class="row"><div>${esc(d.legalEntity.nameAr)}<div class="muted ltr">${esc(d.legalEntity.nameEn)}</div></div>
<div class="muted">الرقم الضريبي / Tax reg.: <span class="ltr">${esc(d.legalEntity.taxRegistrationNumber ?? '-')}</span><br>السجل التجاري / CR: <span class="ltr">${esc(d.legalEntity.commercialRegister ?? '-')}</span></div></div>
<div style="margin-block:6px">المريض / Patient: <b>${esc(d.patient.name)}</b> · <span class="ltr">${esc(d.patient.mrn)}</span></div>
<table><thead><tr><th>الخدمة / Item</th><th class="num">الكمية</th><th class="num">السعر</th><th class="num">الخصم</th><th class="num">الضريبة</th><th class="num">الإجمالي</th></tr></thead><tbody>
${d.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${l.qty}</td><td class="num">${m(l.unitPrice)}</td><td class="num">${m(l.discount)}</td><td class="num">${m(l.vat)}</td><td class="num">${m(l.total)}</td></tr>`).join('')}
</tbody></table>
<table class="totals" style="width:50%;margin-inline-start:auto">
<tr><td>المجموع الفرعي / Subtotal</td><td class="num">${m(d.totals.subtotal)}</td></tr>
<tr><td>الخصم / Discount</td><td class="num">${m(d.totals.discount)}</td></tr>
<tr><td>ضريبة القيمة المضافة ١٤٪ / VAT 14%</td><td class="num">${m(d.totals.vat)}</td></tr>
<tr><td><b>الإجمالي / Total</b></td><td class="num"><b>${m(d.totals.total)}</b></td></tr>
<tr><td>المدفوع / Paid</td><td class="num">${m(d.totals.paid)}</td></tr>
<tr><td>المتبقي / Balance</td><td class="num">${m(d.totals.balance)}</td></tr></table>
${d.payments?.length ? `<table><thead><tr><th>طريقة الدفع / Method</th><th>إيصال</th><th class="num">المبلغ</th></tr></thead><tbody>${d.payments.map((p) => `<tr><td>${esc(p.method)}</td><td class="ltr">${esc(p.receiptNumber ?? '')}</td><td class="num">${m(p.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
${d.eta ? `<div class="sig"><div style="margin-inline-start:auto;text-align:center"><img src="${d.eta.qrDataUrl}" style="width:90px;height:90px"><div class="muted ltr">ETA ${esc(d.eta.uuid.slice(0, 16))}…</div></div></div>` : ''}
<div class="footer">${esc(d.footer ?? '')}</div>`;
  return page({ title, size: 'A4', body });
}

export interface ShiftReportDoc {
  clinic: ClinicHeader;
  cashier: string;
  openedAt: Date;
  closedAt: Date;
  openingFloat: number;
  cashIn: number;
  cashOut: number;
  expected: number;
  counted: number;
  variance: number;
  counts: Record<string, number>;
  payments: { receiptNumber: string; method: string; amount: number }[];
  approvedBy?: string | null;
}

export function shiftReportHtml(d: ShiftReportDoc): string {
  const m = (p: number) => formatMoney(p, 'ar');
  const body = `
${header(d.clinic, `<h2>تقرير الوردية / Shift report</h2><div class="muted">${esc(d.cashier)}</div>`)}
<div class="row"><div>الفتح / Opened: <span class="ltr">${formatDate(d.openedAt)} ${formatTime12(d.openedAt, 'en')}</span></div><div>الإغلاق / Closed: <span class="ltr">${formatDate(d.closedAt)} ${formatTime12(d.closedAt, 'en')}</span></div></div>
<table class="totals" style="width:60%">
<tr><td>رصيد الافتتاح / Opening float</td><td class="num">${m(d.openingFloat)}</td></tr>
<tr><td>مقبوضات نقدية / Cash in</td><td class="num">${m(d.cashIn)}</td></tr>
<tr><td>مردودات نقدية / Cash out</td><td class="num">${m(d.cashOut)}</td></tr>
<tr><td><b>المتوقع / Expected</b></td><td class="num"><b>${m(d.expected)}</b></td></tr>
<tr><td><b>المعدود / Counted</b></td><td class="num"><b>${m(d.counted)}</b></td></tr>
<tr><td><b>الفرق / Variance</b></td><td class="num"><b>${m(d.variance)}</b></td></tr></table>
<table><thead><tr><th>الفئة / Denomination</th><th class="num">العدد</th><th class="num">القيمة</th></tr></thead><tbody>
${Object.entries(d.counts).filter(([, n]) => n > 0).sort((a, b) => Number(b[0]) - Number(a[0])).map(([den, n]) => `<tr><td class="num">${m(Number(den))}</td><td class="num">${n}</td><td class="num">${m(Number(den) * n)}</td></tr>`).join('')}
</tbody></table>
<table><thead><tr><th>إيصال</th><th>الطريقة</th><th class="num">المبلغ</th></tr></thead><tbody>
${d.payments.map((p) => `<tr><td class="ltr">${esc(p.receiptNumber)}</td><td>${esc(p.method)}</td><td class="num">${m(p.amount)}</td></tr>`).join('')}</tbody></table>
${d.approvedBy ? `<p>اعتمد الفرق / Variance approved by: ${esc(d.approvedBy)}</p>` : ''}`;
  return page({ title: 'Shift report', size: 'A4', body });
}

export interface VisitSummaryDoc {
  clinic: ClinicHeader;
  doctor: string;
  patient: { name: string; mrn: string; ageYears: number };
  date: Date;
  chiefComplaint: string;
  diagnoses: { code: string; title: string }[];
  vitals: Record<string, number | undefined>;
  plan: string;
  followUp?: string | null;
  dental?: { tooth: number; status: string; conditions: string; planned: string }[] | null;
}

export function visitSummaryHtml(d: VisitSummaryDoc): string {
  const v = Object.entries(d.vitals).filter(([, x]) => x !== undefined && x !== null);
  const body = `
${header(d.clinic, `<h2>ملخص الزيارة / Visit summary</h2><div class="muted ltr">${formatDate(d.date)}</div>`)}
<div class="row"><div>المريض: <b>${esc(d.patient.name)}</b></div><div class="ltr">${esc(d.patient.mrn)}</div><div>الطبيب: ${esc(d.doctor)}</div></div>
<h3>الشكوى / Complaint</h3><p>${esc(d.chiefComplaint)}</p>
${v.length ? `<h3>العلامات الحيوية / Vitals</h3><table><tr>${v.map(([k]) => `<th>${esc(k)}</th>`).join('')}</tr><tr>${v.map(([, x]) => `<td class="num">${x}</td>`).join('')}</tr></table>` : ''}
<h3>التشخيص / Diagnosis</h3><ul>${d.diagnoses.map((x) => `<li><span class="ltr">${esc(x.code)}</span> ${esc(x.title)}</li>`).join('')}</ul>
<h3>الخطة / Plan</h3><p>${esc(d.plan)}</p>
${d.dental?.length ? `<h3>مخطط الأسنان / Dental chart</h3><table><thead><tr><th>السن / Tooth (FDI)</th><th>الحالة / Status</th><th>الملاحظات / Findings</th><th>الخطة / Planned</th></tr></thead><tbody>${d.dental.map((t) => `<tr><td class="num">${t.tooth}</td><td>${esc(t.status)}</td><td>${esc(t.conditions)}</td><td>${esc(t.planned)}</td></tr>`).join('')}</tbody></table>` : ''}
${d.followUp ? `<p>المتابعة / Follow-up: <span class="ltr">${esc(d.followUp)}</span></p>` : ''}`;
  return page({ title: 'Visit summary', size: 'A4', body });
}

export function labOrderHtml(d: { clinic: ClinicHeader; doctor: string; patient: { name: string; mrn: string }; date: Date; kind: 'lab' | 'radiology'; tests: { code: string; nameAr: string; nameEn: string }[]; note?: string | null }): string {
  const body = `
${header(d.clinic, `<h2>${d.kind === 'lab' ? 'طلب تحاليل / Lab request' : 'طلب أشعة / Radiology request'}</h2><div class="muted ltr">${formatDate(d.date)}</div>`)}
<div class="row"><div>المريض: <b>${esc(d.patient.name)}</b> · <span class="ltr">${esc(d.patient.mrn)}</span></div><div>الطبيب: ${esc(d.doctor)}</div></div>
<table><thead><tr><th>الكود</th><th>الاسم</th><th>Name</th></tr></thead><tbody>${d.tests.map((t) => `<tr><td class="ltr">${esc(t.code)}</td><td>${esc(t.nameAr)}</td><td class="ltr">${esc(t.nameEn)}</td></tr>`).join('')}</tbody></table>
${d.note ? `<p>${esc(d.note)}</p>` : ''}`;
  return page({ title: 'Order', size: 'A5', body });
}

export interface PayslipDoc {
  clinic: ClinicHeader;
  legalEntity?: { nameAr: string; nameEn: string; taxRegistrationNumber?: string | null } | null;
  employee: { name: string; jobTitle: string; socialInsuranceNumber?: string | null; ibanLast4?: string | null };
  /** First day of the month, e.g. 2026-11-01. */
  period: string;
  lines: { labelAr: string; labelEn: string; amount: number; kind: 'earning' | 'deduction' | 'employer'; basis?: string }[];
  gross: number;
  deductions: number;
  net: number;
  attendance: { workedDays: number; absentDays: number; leaveDays: number; lateMinutes: number; overtimeMinutes: number };
  status: string;
}

/** Monthly payslip (Sprint 19), Arabic first with English labels. */
export function payslipHtml(d: PayslipDoc): string {
  const m = (p: number) => formatMoney(p, 'ar');
  const [y, mo] = d.period.split('-');
  const rows = (kind: 'earning' | 'deduction' | 'employer') =>
    d.lines.filter((l) => l.kind === kind).map((l) => `<tr><td>${esc(l.labelAr)} <span class="muted ltr">/ ${esc(l.labelEn)}</span></td><td class="ltr muted">${esc(l.basis ?? '')}</td><td class="num">${m(l.amount)}</td></tr>`).join('');
  const body = `
${header(d.clinic, `<h2>قسيمة راتب / Payslip</h2><div class="ltr">${esc(y ?? '')}-${esc(mo ?? '')}</div>${d.status !== 'paid' && d.status !== 'approved' ? `<div class="muted">مسودة / Draft</div>` : ''}`)}
${d.legalEntity ? `<div class="muted">${esc(d.legalEntity.nameAr)} · <span class="ltr">${esc(d.legalEntity.nameEn)}</span>${d.legalEntity.taxRegistrationNumber ? ` · <span class="ltr">${esc(d.legalEntity.taxRegistrationNumber)}</span>` : ''}</div>` : ''}
<div class="row" style="margin-block:8px"><div>الموظف / Employee: <b>${esc(d.employee.name)}</b><div class="muted">${esc(d.employee.jobTitle)}</div></div>
<div class="muted">الرقم التأميني / Insurance no.: <span class="ltr">${esc(d.employee.socialInsuranceNumber ?? '-')}</span><br>الحساب / Account: <span class="ltr">${d.employee.ibanLast4 ? `•••• ${esc(d.employee.ibanLast4)}` : '-'}</span></div></div>
<table><thead><tr><th>أيام العمل / Worked</th><th>غياب / Absent</th><th>إجازات / Leave</th><th>تأخير (دقيقة) / Late (min)</th><th>إضافي (دقيقة) / Overtime (min)</th></tr></thead>
<tbody><tr><td class="num">${d.attendance.workedDays}</td><td class="num">${d.attendance.absentDays}</td><td class="num">${d.attendance.leaveDays}</td><td class="num">${d.attendance.lateMinutes}</td><td class="num">${d.attendance.overtimeMinutes}</td></tr></tbody></table>
<h3>المستحقات / Earnings</h3><table><tbody>${rows('earning') || '<tr><td colspan="3" class="muted">-</td></tr>'}</tbody></table>
<h3>الاستقطاعات / Deductions</h3><table><tbody>${rows('deduction') || '<tr><td colspan="3" class="muted">-</td></tr>'}</tbody></table>
<table class="totals" style="width:55%;margin-inline-start:auto">
<tr><td>إجمالي الأجر / Gross pay</td><td class="num">${m(d.gross)}</td></tr>
<tr><td>إجمالي الاستقطاعات / Total deductions</td><td class="num">${m(d.deductions)}</td></tr>
<tr><td><b>صافي الأجر / Net pay</b></td><td class="num"><b>${m(d.net)}</b></td></tr></table>
${rows('employer') ? `<h3 class="muted">مساهمات صاحب العمل (للعلم) / Employer contributions (for information)</h3><table><tbody>${rows('employer')}</tbody></table>` : ''}`;
  return page({ title: 'Payslip', size: 'A4', body });
}
