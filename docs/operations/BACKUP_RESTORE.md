# Backup and restore (milestone 5)

## Tooling

The tools are in `apps/api/src/modules/ops/backup.ts` and `src/scripts/backup.ts` /
`restore-drill.ts`. They use only the database driver, with no `mongodump` dependency, so they
run wherever the API runs.

```bash
# Logical backup: gzip'ed JSON lines (header + one Extended-JSON document per line)
npm run ops:backup -w @clinc/api -- --out /secure/raclinic-2026-10-25.jsonl.gz

# Restore drill: a fresh backup of the configured database (or --file <backup>) restored into a NEW
# isolated database clinc_restore_<timestamp>, verified, then dropped (--keep to inspect it)
npm run ops:restore-drill -w @clinc/api
npm run ops:restore-drill -w @clinc/api -- --file /secure/raclinic-2026-10-25.jsonl.gz --keep
```

### Safety rules (enforced and tested)

- A restore only goes into a database named `clinc_restore_*`.
- It refuses:
  - the source database;
  - any database that already has collections.
- The drill drops only `clinc_restore_*` databases.

### Verification per collection

- Document count.
- A SHA-256 digest of the canonical Extended JSON of every document, sorted by `_id`.
- Every non-default index recreated, with its options (uniqueness, partial filters, TTL).

### Handling backup files

A backup file holds all data **in clear text**. Store it encrypted, with restricted access, and
outside the repository. The tool writes files with mode `0600`.

## Drill performed

The drill ran on 2026-10-25 in the development Codespace, against synthetic data only. The source
was the development database `clinc_dev`, holding the synthetic demo seed. The command was
`npm run ops:restore-drill -w @clinc/api`.

```text
appointments            expected     34  restored     34  digest match  indexes 6
audit_events            expected     59  restored     59  digest match  indexes 2
clinical_encounters     expected      5  restored      5  digest match  indexes 3
patients                expected     18  restored     18  digest match  indexes 6
slot_reservations       expected    318  restored    318  digest match  indexes 2
users                   expected     25  restored     25  digest match  indexes 1
… (36 collections in total, every one matching)
Restore drill PASSED: 36 collections into "clinc_restore_20261025025442" from "clinc_dev" in 6 s.
```

The drill database was dropped afterwards. The automated test (`support-ops.test.ts`) repeats a
backup and restore on every CI run. It also checks the refusals and that the unique email index
is restored.

## Not yet decided or built (production gates)

- **Schedule and frequency** (RPO), and the **time allowed to restore** (RTO). These are owner
  decisions.
- **Where backups live:** encrypted, off-site, and in the right country (E1).
- **Retention of the backups themselves.**
- **The hosting provider's point-in-time recovery.** If a managed MongoDB is chosen, its native
  backups should complement this logical backup.
- **A regular drill**, monthly for example, recorded here.
