# ADR 0008: Staff HR and payroll inside the clinic platform

**Status:** accepted (Sprint 19)

## Context
Clinics asked to track every staff member's attendance, leave and hourly permissions (أذونات) and to run monthly
payroll from the same data, instead of a separate HR tool and spreadsheets. Doctors are often paid by commission,
which the platform already calculates (FR-STF-3).

## Decision
- One **active employment contract** per person holds the home clinic, job title, pay basis (monthly, hourly or
  commission only), salary and allowances, insurable wage, encrypted IBAN and a weekly work pattern.
- **Attendance** is one record per person per Cairo calendar day (clock-in/out, lateness beyond a grace period, early
  leaving, overtime). Overtime counts for pay only after a manager approves it. A nightly job marks absences, leave,
  holidays and missing clock-outs. Managers correct records with a reason; every correction is audited.
- **Leave** uses organisation leave types (defaults follow Labour Law 14/2025 as we understand it). Annual and casual
  leave share one yearly balance (15/21/30 days by service and age); other types have their own quotas.
  **Permissions** are short absences within a monthly allowance; an approved permission excuses that time.
- **Payroll** is a monthly run of payslips computed by a pure function in `@hf/shared` (`computePayslip`) from the
  contract, the month's attendance and leave, approved overtime, approved doctor commission and one-off adjustments.
  Social insurance, income tax brackets, the personal exemption and the Martyrs' Fund rate are organisation settings
  with defaults, because the authorities revise them; the run warns when the social-insurance year is out of date.
- **Maker-checker:** accountants prepare runs; a different person with `payroll:approve` approves them (owners may
  approve their own in a single-person office). Approved runs are frozen; corrections go into the next month.
- **Privacy:** salary, insurance and bank data need `payroll:view`; clinic managers handle attendance and leave
  (`hr:*`) without seeing pay. Bank account numbers are encrypted and only decrypted for the bank transfer file.

## Consequences and limits
- The legal figures must be confirmed by the organisation's accountant before the first real payroll, and the
  social-insurance limits updated every January.
- Not modelled: night-shift overtime rates, more than one shift per day, the income-tax phase-out for annual taxable
  income above EGP 600,000 (such payslips are flagged for manual review), sick-leave pay split with the social
  insurance authority, end-of-service settlements, and clock-in location checks (geofencing or clinic network).
