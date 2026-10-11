#!/usr/bin/env python3
"""Convert ThaqalaynAPI book JSON (V2/ThaqalaynData/<n>.json) into a SHAI .db.

Mapping
  category            -> Chaps.title   (one Chaps row per consecutive run of the same category)
  chapter             -> Sections.title (one Sections row per consecutive run within a category)
  arabicText          -> Parags.txt    (a leading "N-" / "Nـ" number prefix is removed)
  <translation field> -> Parags.mean   (default englishText; see --translation-field)
  id                  -> RiwayatMeta.hadith_no (or "volume.id" with --hadith-no-format volume.id)
  first non-empty of  -> RiwayatMeta.grade
    behbudiGrading, majlisiGrading, mohseniGrading, gradingsFull (grade_ar, then grade_en)
  bookId              -> not stored in the app schema (the --bookid option sets Chaps.bookid)

Nothing is invented. Missing translation or grade values stay empty.
Thaqalayn does not provide Urdu. Using englishText fills `mean` with English,
which the app will display as-is. The validator will warn about this.

Usage
  python3 tools/thaqalayn_to_shai_db.py 1.json 2.json -o alkafi_v1-2.db --bookid 1 --force
  python3 tools/thaqalayn_to_shai_db.py 33.json -o test.db --translation-field none
  python3 tools/thaqalayn_to_shai_db.py tools/sample_thaqalayn.json -o /tmp/s.db

Input files are processed in the order given, and their riwayat are
concatenated. `id` restarts in each volume, so the duplicate check uses
(bookId, volume, id). Passing the same riwayat twice is an error. Use
--hadith-no-format volume.id if you combine several volumes and need the
numbers to be unambiguous.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shai_schema import check_chapters, group_rows, write_book_db  # noqa: E402
from validate_book_db import validate  # noqa: E402

DEFAULT_GRADE_ORDER = ["behbudiGrading", "majlisiGrading", "mohseniGrading", "gradingsFull"]

# A numeric prefix followed by a separator: "1ـ ", "12- ", "3. ", "٤ - ".
# A separator is required, so a text that merely starts with a number is kept.
NUM_PREFIX = re.compile(r"^\s*[0-9\u0660-\u0669]+\s*[\u0640\-\u2013\u2014.:)]+\s*")


def strip_number_prefix(text):
    """Return (clean_text, stripped_bool)."""
    if not text:
        return text or "", False
    new = NUM_PREFIX.sub("", text, count=1)
    if new != text and new.strip():
        return new, True
    return text, False


def pick_grade(obj, order, ignore):
    for field in order:
        if field == "gradingsFull":
            entries = obj.get("gradingsFull") or []
            for e in entries:
                if not isinstance(e, dict):
                    continue
                for key in ("grade_ar", "grade_en"):
                    val = (e.get(key) or "").strip()
                    if val and val not in ignore:
                        return val
        else:
            val = (obj.get(field) or "").strip()
            if val and val not in ignore:
                return val
    return None


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("inputs", nargs="+", help="ThaqalaynAPI JSON file(s), each a JSON array of hadith objects")
    p.add_argument("-o", "--output", required=True, help="output .db path")
    p.add_argument("--bookid", type=int, default=1, help="value stored in Chaps.bookid (default 1)")
    p.add_argument("--translation-field", default="englishText",
                   help="JSON field copied to Parags.mean (default englishText; 'none' leaves mean empty)")
    p.add_argument("--grade-order", default=",".join(DEFAULT_GRADE_ORDER),
                   help="comma-separated grading fields in priority order")
    p.add_argument("--ignore-grade", action="append", default=[],
                   help="grade value to treat as 'no grade' (repeatable), e.g. --ignore-grade 'لم يخرجه'")
    p.add_argument("--hadith-no-format", choices=["id", "volume.id"], default="id",
                   help="RiwayatMeta.hadith_no format: the raw id (default) or 'volume.id' (e.g. 1.25)")
    p.add_argument("--no-strip-number", action="store_true",
                   help="keep a leading 'N-' prefix in arabicText")
    p.add_argument("--skip-empty", action="store_true",
                   help="drop riwayat with empty txt and mean (default: error)")
    p.add_argument("--force", action="store_true", help="overwrite an existing output file")
    args = p.parse_args(argv)

    order = [x.strip() for x in args.grade_order.split(",") if x.strip()]
    ignore = set(args.ignore_grade)
    tfield = None if args.translation_field.lower() == "none" else args.translation_field

    rows, seen_ids, seen_book_ids = [], set(), set()
    stripped = graded = 0
    for path in args.inputs:
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(f"ERROR reading {path}: {e}", file=sys.stderr)
            return 2
        if not isinstance(data, list):
            print(f"ERROR {path}: expected a JSON array of hadith objects", file=sys.stderr)
            return 2
        for idx, obj in enumerate(data, 1):
            if not isinstance(obj, dict) or "arabicText" not in obj:
                print(f"ERROR {path} item {idx}: missing arabicText", file=sys.stderr)
                return 2
            hid = obj.get("id")
            dkey = (obj.get("bookId"), obj.get("volume"), hid)
            if dkey in seen_ids:
                print(f"ERROR duplicate riwayat bookId={dkey[0]!r} volume={dkey[1]!r} id={hid} "
                      f"in {path} item {idx} (same file given twice?)", file=sys.stderr)
                return 2
            seen_ids.add(dkey)
            seen_book_ids.add(obj.get("bookId"))
            hadith_no = hid if args.hadith_no_format == "id" else f"{obj.get('volume')}.{hid}"
            if tfield is not None and tfield not in obj:
                print(f"ERROR {path} item {idx}: translation field '{tfield}' not present", file=sys.stderr)
                return 2

            txt = obj.get("arabicText") or ""
            if not args.no_strip_number:
                txt, did = strip_number_prefix(txt)
                stripped += did
            mean = (obj.get(tfield) or "") if tfield else ""
            grade = pick_grade(obj, order, ignore)
            graded += grade is not None

            ck = (obj.get("bookId"), obj.get("volume"), obj.get("categoryId"), obj.get("category"))
            rows.append({
                "chapter_key": ck,
                "chapter": (obj.get("category") or "").strip(),
                "section_key": (ck, obj.get("chapter")),
                "section": (obj.get("chapter") or "").strip(),
                "txt": txt,
                "mean": mean,
                "hadith_no": hadith_no,
                "grade": grade,
            })

    book_ids = sorted({str(r_bid) for r_bid in (b for b in seen_book_ids)})
    if len(book_ids) > 1:
        print(f"WARN: inputs contain {len(book_ids)} different bookId values ({', '.join(book_ids)}). "
              "The app stores one book per .db; check that this is what you want.", file=sys.stderr)

    chapters = group_rows(rows)
    problems = check_chapters(chapters)
    if problems:
        if not args.skip_empty:
            for pr in problems[:20]:
                print("ERROR:", pr, file=sys.stderr)
            print(f"Refusing to write: {len(problems)} riwayat have empty txt and mean. "
                  "Use --skip-empty to drop them.", file=sys.stderr)
            return 1
        for ch in chapters:
            for sec in ch["sections"]:
                sec["riwayat"] = [r for r in sec["riwayat"]
                                  if (r["txt"] or "").strip() or (r["mean"] or "").strip()]
        print(f"NOTE: dropped {len(problems)} riwayat with empty txt and mean (--skip-empty)")

    try:
        counts = write_book_db(args.output, chapters, bookid=args.bookid, force=args.force)
    except FileExistsError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    print(f"Wrote {args.output}: {counts['chapters']} chapters, {counts['sections']} sections, "
          f"{counts['riwayat']} riwayat")
    print(f"  arabicText number prefix stripped: {stripped}")
    print(f"  riwayat with a grade: {graded} (grade order: {', '.join(order)}"
          f"{'; ignored: ' + ', '.join(sorted(ignore)) if ignore else ''})")
    print(f"  mean source: {tfield or '(none, mean left empty)'}")

    errors, warnings, info = validate(args.output)
    for line in info:
        print("INFO:", line)
    for w in warnings:
        print("WARN:", w)
    for e in errors:
        print("ERROR:", e)
    print("Validation:", "FAILED" if errors else "passed")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
