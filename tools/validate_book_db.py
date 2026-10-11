#!/usr/bin/env python3
"""Validate SHAI book .db files against the app schema.

Checks
  * required tables and columns exist (extra tables such as RiwayatMeta are allowed)
  * android_metadata has exactly one row, locale = 'utf-8'
  * PRAGMA integrity_check = ok
  * Chaps.cid is contiguous 1..N (unique, no gaps)
  * no orphan Sections.Chapid (must match Chaps.cid)
  * no orphan Parags.Secid (must match Sections.Secid); Sections.Secid unique
  * paganum starts at 1 in every section and is contiguous
  * no Parags row with both txt and mean empty (error)
  * script of `mean` (warning if Latin, i.e. probably English, not Urdu/Arabic)

Usage
  python3 tools/validate_book_db.py alkafi.db other.db
  python3 tools/validate_book_db.py mybook.db --strict   # warnings also fail

Exit codes: 0 passed, 1 errors (or warnings with --strict), 2 cannot open file.
"""
import argparse
import os
import sqlite3
import sys
from collections import Counter
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shai_schema import REQUIRED_COLUMNS, classify_script  # noqa: E402

MAX_SAMPLE = 5


def _connect(path):
    uri = "file:" + quote(os.path.abspath(path)) + "?mode=ro"
    return sqlite3.connect(uri, uri=True)


def _sample(ids):
    ids = list(ids)
    extra = f" (+{len(ids) - MAX_SAMPLE} more)" if len(ids) > MAX_SAMPLE else ""
    return ", ".join(str(i) for i in ids[:MAX_SAMPLE]) + extra


def validate(path):
    """Return (errors, warnings, info) lists of strings."""
    errors, warnings, info = [], [], []
    if not os.path.isfile(path):
        return [f"file not found: {path}"], [], []
    try:
        con = _connect(path)
        con.execute("SELECT name FROM sqlite_master LIMIT 1").fetchall()
    except sqlite3.Error as e:
        return [f"not a readable SQLite database: {e}"], [], []

    try:
        tables = {r[0]: r[1] for r in con.execute(
            "SELECT name, type FROM sqlite_master WHERE type='table'")}
        lower_tables = {t.lower(): t for t in tables}

        # 1. tables and columns
        for tname, cols in REQUIRED_COLUMNS.items():
            real = lower_tables.get(tname.lower())
            if real is None:
                errors.append(f"missing table {tname}")
                continue
            have = {r[1].lower() for r in con.execute(f"PRAGMA table_info([{real}])")}
            miss = [c for c in cols if c.lower() not in have]
            if miss:
                errors.append(f"table {tname} missing column(s): {', '.join(miss)}")
        extra = sorted(t for t in tables if t.lower() not in {k.lower() for k in REQUIRED_COLUMNS})
        if extra:
            info.append(f"extra tables (ignored by the app): {', '.join(extra)}")

        # 2. integrity
        ic = con.execute("PRAGMA integrity_check").fetchone()[0]
        if ic != "ok":
            errors.append(f"integrity_check: {ic}")

        def has(t):
            return lower_tables.get(t.lower()) is not None

        # 3. android_metadata
        if has("android_metadata"):
            locs = [r[0] for r in con.execute("SELECT locale FROM android_metadata")]
            if locs != ["utf-8"]:
                errors.append(f"android_metadata must contain exactly one row locale='utf-8', found {locs!r}")

        if has("Chaps"):
            cids = [r[0] for r in con.execute("SELECT cid FROM Chaps")]
            n = len(cids)
            if any(c is None for c in cids):
                errors.append("Chaps.cid has NULL values")
            else:
                dup = [c for c, k in Counter(cids).items() if k > 1]
                if dup:
                    errors.append(f"Chaps.cid duplicates: {_sample(dup)}")
                if n and (min(cids) != 1 or max(cids) != n or len(set(cids)) != n):
                    errors.append(f"Chaps.cid is not contiguous 1..{n} (min={min(cids)}, max={max(cids)}, distinct={len(set(cids))})")
            info.append(f"chapters: {n}")
            cid_set = set(c for c in cids if c is not None)
        else:
            cid_set = set()

        if has("Sections"):
            sec_rows = con.execute("SELECT ID, Chapid, Secid FROM Sections").fetchall()
            info.append(f"sections: {len(sec_rows)}")
            orphan_ch = [r[0] for r in sec_rows if r[1] not in cid_set]
            if orphan_ch:
                errors.append(f"orphan Sections.Chapid (no Chaps.cid match): {len(orphan_ch)} rows, IDs {_sample(orphan_ch)}")
            secids = [r[2] for r in sec_rows]
            if any(s is None for s in secids):
                errors.append("Sections.Secid has NULL values")
            dup = [s for s, k in Counter(secids).items() if k > 1]
            if dup:
                errors.append(f"Sections.Secid duplicates: {_sample(dup)}")
            sec_set = set(s for s in secids if s is not None)
        else:
            sec_set = set()

        if has("Parags"):
            total = con.execute("SELECT COUNT(*) FROM Parags").fetchone()[0]
            info.append(f"riwayat (Parags rows): {total}")
            orphan_p = con.execute(
                "SELECT ID FROM Parags WHERE Secid IS NULL OR Secid NOT IN (SELECT Secid FROM Sections)").fetchall()
            if orphan_p:
                errors.append(f"orphan Parags.Secid: {len(orphan_p)} rows, IDs {_sample(r[0] for r in orphan_p)}")
            # paganum: per section, must start at 1 and be contiguous
            bad_start, bad_gap = [], []
            for secid, mn, cnt, mx in con.execute(
                    "SELECT Secid, MIN(paganum), COUNT(*), MAX(paganum) FROM Parags GROUP BY Secid"):
                if mn != 1:
                    bad_start.append(secid)
                elif mx != cnt or mn is None:
                    bad_gap.append(secid)
            if bad_start:
                errors.append(f"paganum does not start at 1 in {len(bad_start)} section(s), Secid {_sample(bad_start)}")
            if bad_gap:
                errors.append(f"paganum has gaps/duplicates in {len(bad_gap)} section(s), Secid {_sample(bad_gap)}")
            empty_both = con.execute(
                "SELECT ID FROM Parags WHERE TRIM(COALESCE(txt,''))='' AND TRIM(COALESCE(mean,''))=''").fetchall()
            if empty_both:
                errors.append(f"rows with txt and mean both empty: {len(empty_both)}, IDs {_sample(r[0] for r in empty_both)}")
            empty_txt = con.execute("SELECT COUNT(*) FROM Parags WHERE TRIM(COALESCE(txt,''))=''").fetchone()[0]
            if empty_txt and not empty_both:
                warnings.append(f"{empty_txt} rows with empty txt")
            elif empty_txt:
                warnings.append(f"{empty_txt} rows with empty txt (includes the rows above)")

            # script checks
            mean_cls, txt_cls = Counter(), Counter()
            for txt, mean in con.execute("SELECT txt, mean FROM Parags"):
                mean_cls[classify_script(mean)] += 1
                txt_cls[classify_script(txt)] += 1
            info.append(f"mean script: {dict(mean_cls)}")
            info.append(f"txt script: {dict(txt_cls)}")
            if mean_cls.get("latin"):
                warnings.append(
                    f"{mean_cls['latin']} rows have a Latin-script mean (probably English, not Urdu). "
                    "The app expects Urdu/Arabic here. Check your --translation-field.")
            if txt_cls.get("latin"):
                warnings.append(f"{txt_cls['latin']} rows have a Latin-script txt (expected Arabic)")
            if mean_cls.get("urdu") and mean_cls.get("arabic"):
                info.append("mean: mixed Urdu/Arabic script (heuristic)")

        if has("RiwayatMeta"):
            m = con.execute(
                "SELECT COUNT(*) FROM RiwayatMeta r WHERE NOT EXISTS "
                "(SELECT 1 FROM Parags p WHERE p.Secid=r.Secid AND p.paganum=r.paganum)").fetchone()[0]
            if m:
                warnings.append(f"RiwayatMeta has {m} rows with no matching Parags (Secid, paganum)")
    except sqlite3.Error as e:
        errors.append(f"SQLite error during validation: {e}")
    finally:
        con.close()
    return errors, warnings, info


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("paths", nargs="+")
    p.add_argument("--strict", action="store_true", help="treat warnings as failures")
    args = p.parse_args(argv)
    worst = 0
    for path in args.paths:
        errors, warnings, info = validate(path)
        print(f"== {path}")
        for line in info:
            print("  INFO:", line)
        for w in warnings:
            print("  WARN:", w)
        for e in errors:
            print("  ERROR:", e)
        if any("not found" in e or "not a readable" in e for e in errors):
            worst = max(worst, 2)
        elif errors or (args.strict and warnings):
            worst = max(worst, 1)
        print("  RESULT:", "FAILED" if (errors or (args.strict and warnings)) else "passed",
              f"({len(errors)} error(s), {len(warnings)} warning(s))")
    return worst


if __name__ == "__main__":
    sys.exit(main())
