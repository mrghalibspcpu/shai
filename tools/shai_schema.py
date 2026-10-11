"""Shared helpers for SHAI book databases (used by build_book_db.py,
thaqalayn_to_shai_db.py and validate_book_db.py).

Stdlib only. Nothing in here invents text: it only lays out data that the
caller supplies.
"""
import os
import re
import sqlite3

# Exact DDL of the tables the Android app reads (copied from the shipped
# alkafi.db). RiwayatMeta is an extra side table the app ignores.
DDL = {
    "android_metadata": "CREATE TABLE [android_metadata] ([locale] CHAR(50))",
    "Chaps": "CREATE TABLE [Chaps] ([ID] INTEGER, [cid] INTEGER, [title] CHAR(255), [bookid] INTEGER)",
    "Sections": "CREATE TABLE [Sections] ([ID] INTEGER, [title] CHAR(255), [Chapid] INTEGER, [Secid] INTEGER)",
    "Parags": "CREATE TABLE Parags (ID INTEGER, txt CHAR, Secid INTEGER, paganum INTEGER, mean CHAR, is_fav INTEGER (2) DEFAULT (0), fav_time TIME DEFAULT NULL)",
    "Fav": "CREATE TABLE [Fav] ([f_bookid] BIGINT, [f_chapid] BIGINT, [f_secid] BIGINT)",
    "Messages": "CREATE TABLE [Messages] ([m_id] BIGINT, [m_Title] NVARCHAR, [m_Text] CHAR, [m_Seen] TINYINT, [m_Date] NVARCHAR(100), [m_view] BIGINT)",
    "Notes": "CREATE TABLE [Notes] ([n_id] BIGINT, [n_Text] NVARCHAR(10000))",
    "RiwayatMeta": "CREATE TABLE [RiwayatMeta] ([Secid] INTEGER, [paganum] INTEGER, [hadith_no] TEXT, [grade] TEXT)",
}

# Column names the app depends on, per table (lower-case comparison).
REQUIRED_COLUMNS = {
    "Chaps": ["id", "cid", "title", "bookid"],
    "Sections": ["id", "title", "chapid", "secid"],
    "Parags": ["id", "txt", "secid", "paganum", "mean", "is_fav", "fav_time"],
    "Fav": ["f_bookid", "f_chapid", "f_secid"],
    "Messages": ["m_id", "m_title", "m_text", "m_seen", "m_date", "m_view"],
    "Notes": ["n_id", "n_text"],
    "android_metadata": ["locale"],
}

# Tables created empty in every book (the app expects them to exist).
EMPTY_TABLES = ["Fav", "Messages", "Notes"]

_ARABIC_RANGES = (
    (0x0600, 0x06FF), (0x0750, 0x077F), (0x08A0, 0x08FF),
    (0xFB50, 0xFDFF), (0xFE70, 0xFEFF),
)
# Letters that occur in Urdu but not in standard Arabic orthography.
URDU_MARKERS = set("\u06D2\u06BA\u06BE\u06C1\u06BE\u0679\u0688\u0691\u06BA\u06CC\u06C3\u06D3\u06BE")
# Letters that are Arabic-specific (Urdu normally writes ی and ک).
ARABIC_MARKERS = set("\u064A\u0643\u0629\u0649")


def is_arabic_script(ch):
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in _ARABIC_RANGES)


def script_profile(text):
    """Return counts of Latin letters, Arabic-script letters and Urdu/Arabic markers."""
    latin = arabic = urdu = arabic_mk = 0
    for ch in text or "":
        if ("a" <= ch <= "z") or ("A" <= ch <= "Z"):
            latin += 1
        elif is_arabic_script(ch):
            arabic += 1
            if ch in URDU_MARKERS:
                urdu += 1
            if ch in ARABIC_MARKERS:
                arabic_mk += 1
    return {"latin": latin, "arabic": arabic, "urdu_markers": urdu, "arabic_markers": arabic_mk}


def classify_script(text):
    """'empty', 'latin', 'urdu', 'arabic' or 'other' (heuristic)."""
    if not (text or "").strip():
        return "empty"
    p = script_profile(text)
    if p["latin"] > p["arabic"]:
        return "latin"
    if p["arabic"] == 0:
        return "other"
    if p["urdu_markers"] > p["arabic_markers"]:
        return "urdu"
    return "arabic"


def group_rows(rows):
    """Turn flat rows into the nested chapter structure.

    Each row must carry: chapter_key, chapter, section_key, section, txt,
    mean, hadith_no, grade. Grouping is by *consecutive runs*: a new chapter
    starts whenever chapter_key changes, and a new section whenever
    section_key changes. Order of the input is preserved.
    """
    chapters = []
    prev_ck = prev_sk = object()
    for r in rows:
        if r["chapter_key"] != prev_ck:
            chapters.append({"title": r["chapter"], "sections": []})
            prev_ck = r["chapter_key"]
            prev_sk = object()
        if r["section_key"] != prev_sk:
            chapters[-1]["sections"].append({"title": r["section"], "riwayat": []})
            prev_sk = r["section_key"]
        chapters[-1]["sections"][-1]["riwayat"].append({
            "txt": r.get("txt"),
            "mean": r.get("mean"),
            "hadith_no": r.get("hadith_no"),
            "grade": r.get("grade"),
        })
    return chapters


def check_chapters(chapters):
    """Return a list of problems (strings) for the nested structure. Empty list = OK."""
    problems = []
    for ci, ch in enumerate(chapters, 1):
        for si, sec in enumerate(ch.get("sections", []), 1):
            for ri, rw in enumerate(sec.get("riwayat", []), 1):
                txt = (rw.get("txt") or "").strip()
                mean = (rw.get("mean") or "").strip()
                if not txt and not mean:
                    problems.append(
                        f"chapter {ci} ('{ch.get('title', '')}') section {si} "
                        f"riwayat {ri}: txt and mean are both empty"
                    )
    return problems


def write_book_db(path, chapters, bookid=1, force=False):
    """Write a SHAI book database from the nested structure.

    chapters: list of {"title", "sections": [{"title", "riwayat": [{"txt", "mean", "hadith_no", "grade"}]}]}
    Empty strings are stored as '' (never invented). Returns a dict of counts.
    """
    if os.path.exists(path) and not force:
        raise FileExistsError(f"{path} exists (use --force to overwrite)")
    tmp = path + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    con = sqlite3.connect(tmp)
    try:
        cur = con.cursor()
        for name in ["android_metadata", "Chaps", "Sections", "Parags"] + EMPTY_TABLES + ["RiwayatMeta"]:
            cur.execute(DDL[name])
        cur.execute("INSERT INTO android_metadata (locale) VALUES ('utf-8')")

        chap_id = sec_id = par_id = 0
        n_sec = n_par = 0
        for cid, ch in enumerate(chapters, 1):
            chap_id += 1
            cur.execute("INSERT INTO Chaps (ID, cid, title, bookid) VALUES (?,?,?,?)",
                        (chap_id, cid, (ch.get("title") or "").strip(), bookid))
            for sec in ch.get("sections", []):
                sec_id += 1
                n_sec += 1
                cur.execute("INSERT INTO Sections (ID, title, Chapid, Secid) VALUES (?,?,?,?)",
                            (sec_id, (sec.get("title") or "").strip(), cid, sec_id))
                for pag, rw in enumerate(sec.get("riwayat", []), 1):
                    par_id += 1
                    n_par += 1
                    txt = (rw.get("txt") or "").strip()
                    mean = (rw.get("mean") or "").strip()
                    if not txt and not mean:
                        raise ValueError(f"empty riwayat at Secid {sec_id} paganum {pag}")
                    cur.execute("INSERT INTO Parags (ID, txt, Secid, paganum, mean, is_fav, fav_time) "
                                "VALUES (?,?,?,?,?,0,NULL)", (par_id, txt, sec_id, pag, mean))
                    hn = rw.get("hadith_no")
                    grade = rw.get("grade")
                    cur.execute("INSERT INTO RiwayatMeta (Secid, paganum, hadith_no, grade) VALUES (?,?,?,?)",
                                (sec_id, pag, None if hn is None else str(hn),
                                 None if grade in (None, "") else str(grade).strip()))
        con.commit()
        con.execute("VACUUM")
        con.close()
        if os.path.exists(path):
            os.remove(path)
        os.replace(tmp, path)
    except Exception:
        con.close()
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return {"chapters": len(chapters), "sections": n_sec, "riwayat": n_par}
