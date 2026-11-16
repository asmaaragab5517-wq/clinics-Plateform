# Reference data

| Data | Source | Load |
|---|---|---|
| Specialties (19), ICD-10 starter subset, lab/radiology tests, sample drugs | `packages/db/src/reference-data.ts` | `pnpm db:seed` |
| Full ICD-10 (WHO, with Arabic titles) | licensed file | bulk `copy` into `icd10_codes` |
| Egyptian drug list (D10) | licensed dataset (EDA list or commercial provider) | bulk load into `drugs` (`source` column records provenance) |
| Governorates and cities (27) | `packages/shared/src/egypt/governorates.ts` | compiled into the app |

The clinician reviewer approves `docs/glossary.ar.md` and the shipped encounter templates before go-live.
