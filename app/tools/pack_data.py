# Step 2 (pack): reads <out-dir>/<book>.json from step 1, writes app/data/*.json.gz and index.json.
# Trims to Arabic + Urdu (+ Urdu summary) and gzips. Paths are hard-coded to /tmp/build/out and /home/user/shai/app/data.
import json, gzip, glob, os

OUT = '/home/user/shai/app/data'
os.makedirs(OUT, exist_ok=True)

# Urdu display names (dataset provides only Arabic + English)
UR_NAMES = {
    'al-kafi': 'الکافی',
    'man-la-yahduruhu-al-faqih': 'من لا یحضرہ الفقیہ',
    'tahdhib-al-ahkam': 'تہذیب الاحکام',
    'al-khisal': 'الخصال',
    'uyun-akhbar-al-rida': 'عیون اخبار الرضا',
    'kamal-al-din': 'کمال الدین و تمام النعمہ',
    'al-amali-saduq': 'الأمالی (شیخ صدوق)',
    'al-tawhid': 'کتاب التوحید',
    'nahj-al-balagha': 'نہج البلاغہ',
}
ORDER = ['al-kafi', 'man-la-yahduruhu-al-faqih', 'tahdhib-al-ahkam', 'nahj-al-balagha',
         'al-khisal', 'uyun-akhbar-al-rida', 'kamal-al-din', 'al-amali-saduq', 'al-tawhid']
UR_SHORT = {
    'al-kafi': 'یہ کتاب شیعہ حدیث کی سب سے معتبر کتاب ہے، جسے شیخ کلینی نے تالیف کیا۔',
}

index = []
_meta = json.load(open('/tmp/ThaqalaynData/books/books.json', encoding='utf-8'))['data']['chapters']
TITLES = {c['path'].split('/')[-1]: c['titles'] for c in _meta if 'titles' in c}
for book in ORDER:
    d = json.load(open(f'/tmp/build/out/{book}.json', encoding='utf-8'))
    chapters = []
    for c in d['chapters']:
        hadith = []
        for h in c['hadith']:
            item = {'id': h['id'], 'ar': h['ar'], 'ur': h['ur']}
            if h.get('s'):
                item['s'] = h['s']
            hadith.append(item)
        chapters.append({'id': c['id'], 'title': {k: v for k, v in c['title'].items() if k in ('ar', 'en', 'ur')}, 'hadith': hadith})
    out = {'id': book, 'title': {'ar': TITLES[book].get('ar', ''), 'en': TITLES[book].get('en', book), 'ur': UR_NAMES[book]}, 'chapters': chapters}
    raw = json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    with gzip.open(f'{OUT}/{book}.json.gz', 'wb', compresslevel=9) as f:
        f.write(raw)
    n = sum(len(c['hadith']) for c in chapters)
    index.append({'id': book, 'title': out['title'], 'hadith_count': n, 'chapter_count': len(chapters),
                  'file': f'data/{book}.json.gz', 'size_kb': round(os.path.getsize(f'{OUT}/{book}.json.gz') / 1024)})
    print(book, n, len(chapters), index[-1]['size_kb'], 'KB')

with open(f'{OUT}/index.json', 'w', encoding='utf-8') as f:
    json.dump({'version': 1, 'books': index}, f, ensure_ascii=False, indent=1)
print('total KB', sum(b['size_kb'] for b in index))
