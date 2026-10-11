# SHAI book tools

Three stdlib-only Python 3 scripts that build and check the per-book `.db`
files the SHAI Android app reads. Nothing here writes hadith text or
translations of its own. The tools only lay out data you supply, and empty
fields stay empty.

| File | Purpose |
|---|---|
| `build_book_db.py` | Build a `.db` from your own JSON (nested) or CSV (flat) file |
| `thaqalayn_to_shai_db.py` | Convert ThaqalaynAPI volume JSON (`V2/ThaqalaynData/<n>.json`) into a `.db` |
| `validate_book_db.py` | Check any `.db` against the app schema |
| `shai_schema.py` | Shared DDL, writer and grouping code (imported by the other three) |
| `sample_input.json`, `sample_input.csv` | Fixtures for `build_book_db.py`. Placeholder text only |
| `sample_thaqalayn.json` | Fixture for `thaqalayn_to_shai_db.py`. Same field layout as the real data, placeholder text only |

Requires Python 3.8+. No third-party packages.

## Schema

Every book `.db` contains these tables, with the same DDL as the shipped `alkafi.db`:

```
Chaps(ID, cid, title, bookid)
Sections(ID, title, Chapid, Secid)          -- Chapid = Chaps.cid
Parags(ID, txt, Secid, paganum, mean, is_fav, fav_time)   -- Secid = Sections.Secid
Fav(f_bookid, f_chapid, f_secid)            -- empty
Messages(m_id, m_Title, m_Text, m_Seen, m_Date, m_view)   -- empty
Notes(n_id, n_Text)                         -- empty
android_metadata(locale)                    -- one row: 'utf-8'
RiwayatMeta(Secid, paganum, hadith_no, grade)   -- extra side table, ignored by the app
```

Rules the validator enforces: `Chaps.cid` is contiguous 1..N, there are no
orphan `Sections.Chapid` or `Parags.Secid` values, `paganum` runs 1..N in
each section, and no row has both `txt` and `mean` empty.

`txt` holds the Arabic matan. `mean` holds the translation. The app expects
Urdu there.

## 1. Thaqalayn JSON → .db

Source: `github.com/MohammedArab1/ThaqalaynAPI` (GPL-3.0; data from
thaqalayn.net). Download the volume files from `V2/ThaqalaynData/<n>.json`
and `BookNames.json` (which lists the `bookId` values).

```bash
# one volume
python3 tools/thaqalayn_to_shai_db.py 1.json -o alkafi_v1.db --bookid 1 --translation-field none

# several volumes of the same book, in order
python3 tools/thaqalayn_to_shai_db.py 1.json 2.json 3.json -o mybook.db --hadith-no-format volume.id
```

Field mapping:

| Thaqalayn field | SHAI field |
|---|---|
| `category` (grouped by `bookId`, `volume`, `categoryId`) | `Chaps.title` |
| `chapter` (consecutive runs within a category) | `Sections.title` |
| `arabicText` (leading `N-` / `Nـ` number prefix removed) | `Parags.txt` |
| `--translation-field` (default `englishText`) | `Parags.mean` |
| `id` (or `volume.id` with `--hadith-no-format volume.id`) | `RiwayatMeta.hadith_no` |
| first non-empty of `behbudiGrading`, `majlisiGrading`, `mohseniGrading`, `gradingsFull` (`grade_ar`, then `grade_en`) | `RiwayatMeta.grade` |

Options: `--translation-field <name>` (or `none`), `--grade-order`,
`--ignore-grade <value>` (repeatable), `--skip-empty`, `--force`,
`--no-strip-number`.

Things to know before you use the output:

* **Thaqalayn has no Urdu.** With the default `englishText`, `mean` holds
  English, and the validator warns about it. Pass `--translation-field none`
  to leave `mean` empty, or use a translation field you have from another source.
  The tool never fills a translation in itself.
* **`id` restarts in every volume.** Use `--hadith-no-format volume.id` when
  you combine volumes. The `volume` value is per book, so the format is only
  unambiguous within one `bookId`. The tool warns if one run mixes bookIds.
* **Grades can be non-grades.** In volume 1, `behbudiGrading` is `لم يخرجه`
  ("not included") for about 74 of 1,449 rows. Because it is non-empty, the
  default priority order picks it up. Pass `--ignore-grade "لم يخرجه"` to skip it.
* **The app's `alkafi.db` is abridged.** A Thaqalayn Kafi conversion is a
  separate, full-length book. It is not a drop-in replacement.
* Check the GPL-3.0 terms of the ThaqalaynAPI data before you redistribute
  generated `.db` files.

## 2. Your own JSON or CSV → .db

Nested JSON (`sample_input.json`):

```json
{"chapters": [
  {"title": "...", "sections": [
    {"title": "...", "riwayat": [
      {"txt": "<Arabic>", "mean": "<translation>", "hadith_no": "1", "grade": "optional"}
    ]}
  ]}
]}
```

Flat CSV (`sample_input.csv`). Required columns: `chapter,section,txt,mean`.
Optional: `hadith_no,grade`. Rows are grouped by consecutive runs of the same
chapter and section.

```bash
python3 tools/build_book_db.py tools/sample_input.json -o /tmp/sample.db
python3 tools/build_book_db.py books.csv -o mybook.db --bookid 7 --force
```

Empty `txt` and `mean` in the same riwayat is an error. Use `--skip-empty` to drop those rows.

## 3. Validate any .db

```bash
python3 tools/validate_book_db.py alkafi.db other.db
python3 tools/validate_book_db.py mybook.db --strict   # warnings also fail
```

Exit codes: `0` passed, `1` errors (or warnings with `--strict`), `2` file cannot be read.

Checks: required tables and columns, `android_metadata` = `'utf-8'`,
`PRAGMA integrity_check`, `Chaps.cid` contiguity, orphan `Sections.Chapid`
and `Parags.Secid`, `Sections.Secid` uniqueness, `paganum` starting at 1 and
contiguous, rows with both text fields empty, and the script of `txt` and
`mean` (a Latin-script `mean` gives a warning). Column types are not compared.

## Tests used

* Fixtures: `build_book_db.py` on both fixtures, `thaqalayn_to_shai_db.py` on
  `sample_thaqalayn.json`, then validation.
* Real Thaqalayn data: volumes 1 and 33 converted, plus a two-volume run in
  `volume.id` mode.
* Negative cases: each corruption (cid gap, orphan link, paganum 0 or gap,
  empty row, bad locale, missing table or column, garbage file) is flagged.
* `alkafi.db`: validation fails with the existing issues (below). A round-trip
  (export to JSON, rebuild, compare) reproduces all 8,020 usable rows exactly.

Existing problems in the shipped `alkafi.db` that the validator reports
(not caused by these tools, and not changed here):

* 1 section (row ID 89105, Secid 376) has an empty `Chapid`, so it points to no chapter.
* 9 paragraphs point to non-existent sections.
* 10 paragraphs have both `txt` and `mean` empty.
* `paganum` does not start at 1 in 6 sections and has gaps in 1.
