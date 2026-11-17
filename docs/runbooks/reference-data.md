# Reference data

| Data | Source | Load |
|---|---|---|
| Specialties (19), ICD-10 starter subset, lab/radiology tests, sample drugs | `packages/db/src/reference-data.ts` | `pnpm db:seed` |
| Full ICD-10 (WHO, with Arabic titles) | licensed file | bulk `copy` into `icd10_codes` |
| Egyptian drug list (D10) | licensed dataset (EDA list or commercial provider) | bulk load into `drugs` (`source` column records provenance) |
| Governorates and cities (27) | `packages/shared/src/egypt/governorates.ts` | compiled into the app |

## Importing licensed data

```bash
DATABASE_ADMIN_URL=... node packages/db/dist/import-reference-cli.js drugs eda-drugs.csv --source=eda-2026-11 --dry-run
```

`drugs`, `interactions` and `icd10` take UTF-8 CSV with a header row (columns in the CLI's header comment). The whole
file is validated first and nothing is written if any row fails; interactions are upserted by normalised ingredient pair,
ICD-10 by code. `--source` is stored on each drug and interaction row for provenance.

The clinician reviewer approves `docs/glossary.ar.md` and the shipped encounter templates before go-live.
