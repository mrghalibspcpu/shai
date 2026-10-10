# Step 1 (extract): python3 extract.py <book-ids,comma-separated> <out-dir>
# Source: git clone https://github.com/narmafraz/ThaqalaynData (CC0), expected at /tmp/ThaqalaynData
import json, os, re, sys
from pathlib import Path

SRC = Path('/tmp/ThaqalaynData/books')
BOOKS = sys.argv[1].split(',')
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
NUM = re.compile(r'^\d+$')


def load(p):
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def chunks_text(obj):
    if not obj:
        return ''
    ai = obj.get('ai') or {}
    ch = ai.get('chunks') or []
    return '\n'.join(c.strip() for c in ch if c and c.strip())


def arabic(verse):
    t = verse.get('text') or []
    if isinstance(t, list):
        return '\n'.join(x.strip() for x in t if x and x.strip())
    return str(t).strip()


for book in BOOKS:
    bdir = SRC / book
    meta = load(SRC / f'{book}.json')
    title = {'ar': '', 'en': book}
    if meta:
        for c in meta['data']['chapters']:
            if c.get('path') == f'/books/{book}':
                title = c.get('titles', title)
    rows = {}
    for p in bdir.rglob('*.json'):
        if not NUM.match(p.stem):
            continue
        d = load(p)
        if not d or 'data' not in d or 'verse' not in d['data']:
            continue
        v = d['data']['verse']
        if v.get('part_type') != 'Hadith':
            continue
        rel = p.relative_to(bdir).with_suffix('')
        key = tuple(int(x) for x in rel.parts)
        ur_obj = load(p.with_name(p.stem + '.ur.json')) or {}
        en_obj = load(p.with_name(p.stem + '.en.json')) or {}
        rows[key] = dict(
            chapter=d['data'].get('chapter_path'),
            chapter_title=d['data'].get('chapter_title') or {},
            id=book + ':' + ':'.join(str(x) for x in key),
            ar=arabic(v),
            ur=chunks_text(ur_obj),
            en=chunks_text(en_obj),
            s=((ur_obj.get('ai') or {}).get('summary')) or '',
        )
    chapters, order = {}, []
    for key in sorted(rows):
        r = rows[key]
        cp = r['chapter']
        if cp not in chapters:
            chapters[cp] = dict(id=cp, title=r['chapter_title'], hadith=[])
            order.append(cp)
        chapters[cp]['hadith'].append(dict(id=r['id'], ar=r['ar'], ur=r['ur'], en=r['en'], s=r['s']))
    out = dict(id=book, title=title, chapters=[chapters[c] for c in order])
    n = sum(len(c['hadith']) for c in out['chapters'])
    nur = sum(1 for c in out['chapters'] for h in c['hadith'] if h['ur'])
    nen = sum(1 for c in out['chapters'] for h in c['hadith'] if h['en'])
    path = OUT / f'{book}.json'
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{book}: hadith={n} ur={nur} en={nen} chapters={len(out["chapters"])} size={os.path.getsize(path)/1e6:.2f}MB', flush=True)
