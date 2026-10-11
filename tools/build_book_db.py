#!/usr/bin/env python3
"""Build an app-compatible SHAI book .db from user-supplied JSON or CSV.

This tool only lays out the data you give it. It never writes hadith text
or translations of its own. Empty fields stay empty.

Input formats
-------------
1) JSON (nested), e.g. tools/sample_input.json:
   {"chapters": [
      {"title": "...", "sections": [
         {"title": "...", "riwayat": [
            {"txt": "<Arabic>", "mean": "<translation>",
             "hadith_no": "1", "grade": "optional"}
         ]}
      ]}
   ]}
   A bare top-level list of chapter objects is also accepted.

2) CSV (flat, one riwayat per row). Required columns: chapter, section,
   txt, mean. Optional: hadith_no, grade. Rows that share the same
   chapter/section values in consecutive order are grouped together.
   Column names can be changed with the --*-col options.

Usage
-----
  python3 tools/build_book_db.py tools/sample_input.json -o /tmp/sample.db
  python3 tools/build_book_db.py books.csv -o mybook.db --bookid 7 --force

After writing, the result is checked with validate_book_db.py. The exit
code is 1 if the check reports errors.
"""
import argparse
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shai_schema import check_chapters, group_rows, write_book_db  # noqa: E402
from validate_book_db import validate  # noqa: E402


def load_json(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    chapters = data.get("chapters") if isinstance(data, dict) else data
    if not isinstance(chapters, list):
        raise ValueError("JSON must be a list of chapters or an object with a 'chapters' list")
    out = []
    for ci, ch in enumerate(chapters, 1):
        if not isinstance(ch, dict) or not isinstance(ch.get("sections", []), list):
            raise ValueError(f"chapter {ci}: expected an object with a 'sections' list")
        secs = []
        for si, sec in enumerate(ch.get("sections", []), 1):
            if not isinstance(sec, dict) or not isinstance(sec.get("riwayat", []), list):
                raise ValueError(f"chapter {ci} section {si}: expected a 'riwayat' list")
            secs.append({
                "title": str(sec.get("title") or ""),
                "riwayat": [
                    {"txt": r.get("txt") or "", "mean": r.get("mean") or "",
                     "hadith_no": r.get("hadith_no"), "grade": r.get("grade")}
                    for r in sec.get("riwayat", [])
                ],
            })
        out.append({"title": str(ch.get("title") or ""), "sections": secs})
    return out


def load_csv(path, args):
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        needed = [args.chapter_col, args.section_col, args.txt_col, args.mean_col]
        missing = [c for c in needed if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"CSV is missing column(s): {', '.join(missing)}")
        for rec in reader:
            ch = (rec[args.chapter_col] or "").strip()
            sec = (rec[args.section_col] or "").strip()
            rows.append({
                "chapter_key": ch,
                "chapter": ch,
                "section_key": (ch, sec),
                "section": sec,
                "txt": rec[args.txt_col] or "",
                "mean": rec[args.mean_col] or "",
                "hadith_no": (rec.get(args.hadith_col) or None),
                "grade": (rec.get(args.grade_col) or None),
            })
    return group_rows(rows)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", help="input .json or .csv file you supply")
    p.add_argument("-o", "--output", required=True, help="output .db path")
    p.add_argument("--bookid", type=int, default=1, help="value stored in Chaps.bookid (default 1)")
    p.add_argument("--format", choices=["auto", "json", "csv"], default="auto")
    p.add_argument("--force", action="store_true", help="overwrite an existing output file")
    p.add_argument("--skip-empty", action="store_true",
                   help="drop riwayat whose txt and mean are both empty (default: error)")
    p.add_argument("--chapter-col", default="chapter")
    p.add_argument("--section-col", default="section")
    p.add_argument("--txt-col", default="txt")
    p.add_argument("--mean-col", default="mean")
    p.add_argument("--hadith-col", default="hadith_no")
    p.add_argument("--grade-col", default="grade")
    args = p.parse_args(argv)

    fmt = args.format
    if fmt == "auto":
        fmt = "csv" if args.input.lower().endswith(".csv") else "json"
    try:
        chapters = load_json(args.input) if fmt == "json" else load_csv(args.input, args)
    except (ValueError, KeyError, json.JSONDecodeError) as e:
        print(f"ERROR reading input: {e}", file=sys.stderr)
        return 2

    if args.skip_empty:
        dropped = 0
        for ch in chapters:
            for sec in ch["sections"]:
                keep = [r for r in sec["riwayat"] if (r["txt"] or "").strip() or (r["mean"] or "").strip()]
                dropped += len(sec["riwayat"]) - len(keep)
                sec["riwayat"] = keep
        if dropped:
            print(f"NOTE: dropped {dropped} riwayat with empty txt and mean (--skip-empty)")
    problems = check_chapters(chapters)
    if problems:
        for pr in problems[:20]:
            print("ERROR:", pr, file=sys.stderr)
        if len(problems) > 20:
            print(f"ERROR: ...and {len(problems) - 20} more", file=sys.stderr)
        print("Refusing to write. Fix the input or pass --skip-empty.", file=sys.stderr)
        return 1

    try:
        counts = write_book_db(args.output, chapters, bookid=args.bookid, force=args.force)
    except FileExistsError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    print(f"Wrote {args.output}: {counts['chapters']} chapters, {counts['sections']} sections, "
          f"{counts['riwayat']} riwayat")

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
