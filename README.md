# 🕯️ SHAI — Shia Hadith AI

**شائی** — ایک پروڈکشن-ریڈی اینڈرائیڈ / ویب ایپ جو مستند شیعی احادیث، قرآنی آیات اور ادعیہ کی بنیاد پر
**خوبصورت، آسان اور دلچسپ اردو** میں جواب دیتی ہے — ہر بات کے ساتھ
[Thaqalayn](https://thaqalayn.com) کا براہِ راست، ایک ٹیپ پر کھلنے والا حوالہ۔

> **📚 پوری لائبریری ایپ کے اندر:** **52,527 احادیث و روایات** (23 کتب) + **6,236 قرآنی آیات** —
> عربی متن، سند، انگریزی اور اردو ترجمے کے ساتھ، مکمل طور پر **آف لائن**۔
> تفصیل نیچے [آف لائن لائبریری](#-آف-لائن-لائبریری) میں۔

> **Zero hallucination by design.** ماڈل کو سختی سے ہدایت دی گئی ہے کہ وہ کبھی حدیث، آیت،
> کتاب، جلد، باب یا حدیث نمبر نہ گھڑے۔ ہر حوالہ ایک مشینی طور پر **تصدیق شدہ** (`verified id`)
> Thaqalayn ID پر مبنی ہوتا ہے؛ جو ID تصدیق نہ ہو سکے اُسے `unverified` نشان زد کر دیا جاتا ہے۔

---

## ✨ نمایاں خصوصیات

| | |
|---|---|
| **اردو ٹائپوگرافی** | *Jameel Noori Nastaleeq* (ریپو میں موجود TTF) — سب سیٹ + WOFF2 کے ساتھ، `font-display: swap` اور Noto Nastaliq فال بیک |
| **عربی متن** | Amiri / Scheherazade New (Google Fonts) — قرآن اور حدیث کے اصل متن کے لیے الگ بلاک |
| **UI** | Dark Islamic glassmorphism — aurora gradients، girih پیٹرن، نرم اینیمیشنز، RTL-first لے آؤٹ |
| **Onboarding** | 2-Step frictionless setup: *Sign in to AI Studio* → *Get API Key* → paste → **validate & save** |
| **Streaming** | Gemini `streamGenerateContent?alt=sse` — لفظ بہ لفظ جواب، روکنے کا بٹن، regenerate |
| **حوالہ جات** | `## References (Hawalajat)` — کتاب، جلد، باب، حدیث، درجہ (Sahih/Hasan/Ḍaʿīf)، grader، اور Thaqalayn کے deep links (حدیث / باب / کتاب / عربی) |
| **محفوظ** | API key صرف ڈیوائس پر (Capacitor Preferences / localStorage) — کوئی سرور، کوئی لاگ، کوئی کلاؤڈ نہیں |
| **APK** | Capacitor 7 کے ذریعے انسٹال ہونے والا Android پیکج + GitHub Actions میں خودکار APK بلڈ |

---

## 📲 APK ڈاؤن لوڈ کریں (تیار، انسٹال کرنے کے لیے)

**👉 <https://github.com/mrghalibspcpu/shai/releases/download/v1.2.0/SHAI-release.apk>**

| فائل | سائز | استعمال |
|---|---|---|
| **`SHAI-release.apk`** | ~45 MB | ✅ **یہ انسٹال کریں** — release build، signed، مکمل آف لائن لائبریری کے ساتھ |
| `SHAI-debug.apk` | 9.6 MB | صرف ڈیولپمنٹ / ٹیسٹنگ کے لیے |

**انسٹال کرنے کا طریقہ**

1. اوپر دیا گیا لنک فون کے براؤزر میں کھولیں (یا نیچے دیا QR کوڈ اسکین کریں)۔
2. **Settings → Security → Install unknown apps** سے اپنے براؤزر کی اجازت دیں۔
3. ڈاؤن لوڈ شدہ APK پر ٹیپ کریں → **Install**۔
4. ایپ کھولیں → **Get API Key** → <https://aistudio.google.com/app/apikey> →
   Key کاپی کر کے paste کریں۔ Key صرف آپ کے فون پر محفوظ ہوتی ہے۔

> ہر بلڈ ایک ہی signing key سے sign ہوتا ہے، اس لیے آئندہ اپ ڈیٹ
> **بغیر ان انسٹال کیے** اوپر انسٹال ہو جائے گا۔

**QR کوڈ:** `build/SHAI-APK-QR.png` (ڈاؤن لوڈ) · `build/SHAI-RELEASE-QR.png` (ریلیز صفحہ)

## 🚀 فوری آغاز (ویب)

```bash
git clone <repo> && cd shai
npm install
npm run dev          # → http://localhost:5173
```

پہلی بار چلانے پر setup modal آئے گا:

1. **Sign in to AI Studio** → <https://aistudio.google.com/>
2. **Get API Key** → <https://aistudio.google.com/app/apikey>
3. Key paste کریں → **محفوظ کریں اور جاری رکھیں**

Key کو Gemini API سے حقیقی طور پر جانچا جاتا ہے (`GET /v1beta/models`)؛ کامیابی پر
دستیاب ماڈلز کی فہرست سے بہترین ماڈل (`gemini-2.5-flash`) خود بخود منتخب ہو جاتا ہے۔

---

## 📱 Android APK

تفصیلی ہدایات → **[APK_BUILD.md](./APK_BUILD.md)**

```bash
# ایک بار:
npm run cap:add              # android/ پروجیکٹ پہلے سے موجود ہے

# ہر بلڈ پر:
npm run apk:debug            # → build/SHAI-debug.apk
npm run apk:release          # → build/SHAI-release-unsigned.apk

# ڈیوائس پر:
adb install -r build/SHAI-debug.apk
```

**یا بغیر کسی مقامی سیٹ اپ کے:** GitHub پر `main` برانچ پر push کریں یا کوئی tag
(مثلاً `v1.0.0`) دیں — [GitHub Action](./.github/workflows/apk.yml)
خودکار طور پر debug + release APK بنا کر artifact اور release میں attach کر دیتا ہے۔

> APK **GitHub Actions پر build ہو کر [releases](https://github.com/mrghalibspcpu/shai/releases)
> میں شائع ہوتا ہے** — اوپر دیے گئے لنک سے براہِ راست ڈاؤن لوڈ کریں۔
> مقامی مشین پر خود build کرنے کے لیے (JDK 21 + Android SDK کے ساتھ)
> `npm run apk:debug` چلائیں، یا بس `main` پر push کریں — CI خود APK بنا دے گا۔

---

## 🧪 ٹیسٹ

```bash
npm test           # unit + boot smoke (148 assertions)
npm run test:unit  # pipeline: sources → citations → markdown → prompt → storage
npm run test:smoke # پوری ایپ jsdom میں boot ہو کر چلتی ہے
```

`npm test` دو سوٹ چلاتا ہے:

1. **Self-test** (116 assertions) — Thaqalayn URL بنانے والے فنکشنز، citation extraction
   (مکمل / ادھورا / inline / جعلی ID)، markdown رینڈرر (اردو، عربی، قرآن، nested lists،
   tables، XSS escaping)، سسٹم پرامپٹ، Gemini error mapping، storage round-trip،
   اردو/عربی/انگریزی tokenising، اور **پوری آف لائن لائبریری** (تلاش، shard لوڈنگ،
   grounding، citation تصدیق)۔
2. **Boot smoke** (32 assertions) — ایپ کو ایک IIFE بنڈل کے طور پر jsdom میں boot کر کے
   shell، onboarding کے deep links، sources drawer، settings sheet، composer اور
   conversation flows کو چیک کرتا ہے — **صفر runtime errors**۔

---

## 🏗️ پروجیکٹ کی ساخت

```
shai/
├── index.html                     # RTL/Urdu shell: splash, sidebar, thread, composer, 3 modals
├── Jameel Noori Nastaleeq Regular.ttf   # اصل فونٹ (10.8 MB)
├── assets/                        # Android icon / splash سورس
├── public/
│   ├── manifest.webmanifest       # PWA
│   └── icons/
├── scripts/
│   ├── build-corpus.mjs           # ThaqalaynData (CC0) → public/data/corpus
│   ├── fetch-thaqalayn-data.sh    # CC0 ڈیٹا سیٹ vendor/ میں لانے کے لیے
│   ├── build-fonts.mjs            # TTF → subset → WOFF2 (fonttools)
│   ├── build-apk.sh               # debug / release / signed APK
│   ├── self-test.mjs              # 116 assertions
│   └── smoke.mjs                  # jsdom boot test
├── src/
│   ├── main.js                    # app entry / orchestration
│   ├── styles/
│   │   ├── tokens.css             # ڈیزائن ٹوکنز + aurora background
│   │   ├── fonts.css              # @font-face + عربی/اردو کلاسیں
│   │   └── app.css                # components
│   ├── lib/
│   │   ├── corpus.js              # آف لائن لائبریری: تلاش، shards، grounding
│   │   ├── text.js                # عربی/اردو/انگریزی normalise + tokenise
│   │   ├── sources.js             # Thaqalayn رجسٹری (39 collections) + URL builders
│   │   ├── citations.js           # ```refs JSON → تصدیق شدہ حوالہ جات
│   │   ├── markdown.js            # RTL/Urdu markdown renderer
│   │   ├── gemini.js              # streaming API client + key validation
│   │   ├── prompt.js              # SHAI system instruction
│   │   ├── storage.js             # Capacitor Preferences
│   │   └── dom.js                 # helpers
│   └── ui/
│       ├── onboarding.js          # 2-step API key setup
│       ├── chat.js                # thread rendering + streaming
│       ├── settings.js
│       └── sources.js
├── public/data/corpus/            # 58,763 ریکارڈز: manifest + index + 47 shards
├── data/legacy/                   # پرانا 1502 ریکارڈ کا crawl (صرف gradings کا ماخذ)
├── android/                       # Capacitor Android project
└── .github/workflows/apk.yml      # CI: test → build → APK artifact
```

---

## 📚 آف لائن لائبریری

پہلے ایپ میں صرف **1,502** روایات کا ایک چھوٹا سا crawl تھا۔ اب پوری مستند لائبریری
ایپ کے اندر موجود ہے — **35 گنا زیادہ** — اور وہ انٹرنیٹ کے بغیر تلاش بھی ہوتی ہے۔

| | |
|---|---|
| **احادیث و روایات** | **52,527** (23 کتب) |
| **قرآنی آیات** | **6,236** (114 سورتیں) |
| **کل ریکارڈز** | **58,763** |
| **اردو تراجم** | 52,586 |
| **انگریزی تراجم** | 57,764 |
| **سند (isnād)** | 46,478 |
| **Thaqalayn deep links** | 27,204 |
| **سائز (APK میں)** | ~37 MB (gzip شدہ، 47 shards) |

**کتب:** الکافی (16,254) · تہذیب الاحکام (13,201) · من لا یحضرہ الفقیہ (6,382) ·
الاستبصار (4,220) · نہج البلاغہ (2,260) · الخصال (1,282) · ثواب الاعمال (1,106) ·
الامالی للصدوق (1,082) · عیون اخبار الرضا (954) · معانی الاخبار (829) ·
الغیبة للطوسی (774) · کامل الزیارات (750) · التوحید (575) · کمال الدین (566) ·
معجم الاحادیث المعتبرة (555) · الغیبة للنعمانی (468) · الامالی للمفید (387) ·
کتاب الزہد (290) · کتاب الضعفاء (226) · کتاب المؤمن (201) · صفات الشیعہ (71) ·
رسالة الحقوق (49) · فضائل الشیعہ (45) · اور قرآنِ مجید۔

### ماخذ اور لائسنس

* **[ThaqalaynData](https://github.com/narmafraz/ThaqalaynData)** — وہی ڈیٹا جو
  thaqalayn.net / thaqalayn.com چلاتا ہے۔ لائسنس: **CC0-1.0 (public domain)**۔
  عربی متن، سند اور تراجم اسی سے آتے ہیں۔
* **thaqalayn.com crawl** — درجہ بندی (صحیح / حسن / موثق / ضعیف / مرسل / معتبر)
  اور درجہ دینے والے عالم کا نام اسی پرانے crawl سے منتقل کیا گیا ہے۔
* تراجم جن کے ساتھ `en.ai` / `ur.ai` لکھا ہے وہ اسی CC0 ڈیٹا سیٹ کی مشینی تراجم ہیں —
  معاونت کے لیے، نہ کہ علمی ترجمے کے طور پر۔

### دوبارہ بنانے کا طریقہ

```bash
npm run corpus:fetch                                    # CC0 ڈیٹا سیٹ → vendor/
THAQALAYN_DATA=vendor/ThaqalaynData/books npm run build:corpus
```

بلڈر مکمل طور پر آف لائن اور deterministic ہے — کوئی ویب سائٹ scrape نہیں ہوتی۔

### حوالہ جات کی دیانت

ہر ریکارڈ کی شناخت اس کے **اصل canonical id** سے ہوتی ہے۔ جہاں ڈیٹا سیٹ کا اپنا
`source_url` موجود اور غیر متضاد ہے، وہاں براہِ راست `thaqalayn.com/hadith/…` لنک بنتا ہے۔
دو کتابوں (من لا یحضرہ الفقیہ، عیون اخبار الرضا) میں ڈیٹا سیٹ کے `source_url` آپس میں
ٹکراتے تھے، اور تین کتابیں (تہذیب، الاستبصار، کمال الدین) بغیر `source_url` کے ہیں —
ان کا کوئی جعلی deep link **نہیں** بنایا گیا؛ ان کے حوالے کتاب / جلد / باب / حدیث کی
صحیح نشاندہی کے ساتھ Thaqalayn **سرچ** لنک پر کھلتے ہیں۔

## 🧠 RAG / Anti-Hallucination ڈیزائن

اب grounding صرف "اجازت شدہ ids کی فہرست" نہیں رہی — ہر سوال پر ایپ **اپنی لائبریری میں
تلاش** کرتی ہے اور سب سے متعلقہ روایات ماڈل کے سامنے رکھ دیتی ہے:

1. **حقیقی retrieval** — `lib/corpus.js` اردو/عربی/انگریزی سوال کو normalise کر کے
   BM25 طرز کے inverted index پر چلاتی ہے (113,847 الفاظ کا ذخیرہ)، top-6 روایات
   پوری سند و متن کے ساتھ سسٹم پرامپٹ میں **GROUNDING** کے طور پر شامل ہو جاتی ہیں،
   ہر ایک کے ساتھ اس کا اصل `id`۔ ماڈل کو حکم ہے کہ صرف وہی ids نقل کرے۔
2. **تصدیق** — جواب میں آنے والا ہر `path` لائبریری میں تلاش کیا جاتا ہے: مل جائے تو
   `verified · لائبریری میں موجود`، ورنہ `unverified`۔

اس کے علاوہ پرانی **تین تہیں** بھی برقرار ہیں:

1. **مجاز IDs کی بند فہرست** — سسٹم پرامپٹ میں Thaqalayn کے 39 حقیقی collection IDs
   (براہِ راست `thaqalayn.com/sitemap/books.xml` سے ماخوذ) شامل ہیں، اور ماڈل کو سختی سے
   کہا گیا ہے کہ **صرف انہی** IDs پر حوالہ دے۔
2. **Structured citations** — ماڈل کو ہدایت ہے کہ وہ جواب کے آخر میں
   ```refs fenced JSON array لکھے (`{"path":"1/2/17/14","grading":"Sahih",…}`)۔
   کلائنٹ اس JSON کو پارس کر کے **خود** لنک بناتا ہے — ماڈل کبھی URL نہیں لکھتا۔
3. **Client-side validation** — ہر `path` کو رجسٹری سے ملایا جاتا ہے؛
   تصدیق شدہ حوالے پر `verified id` اور مشکوک پر `unverified` ٹیگ لگتا ہے۔
   اس کے علاوہ ماڈل کو حکم ہے کہ اگر معلوم نہ ہو تو صاف لکھے:
   *"اس بارے میں مجھے کوئی مستند حوالہ دستیاب نہیں ہے۔"*

### حوالہ جات کی شکلیں

| قسم | ماڈل کی آؤٹ پٹ | بننے والا لنک |
|---|---|---|
| حدیث | `{"path":"1/2/17/14", …}` | `https://thaqalayn.com/hadith/1/2/17/14` (+ chapter / book / ar) |
| قرآن | `{"surah":17,"verse":79}` | `https://thaqalayn.com/quran/17/79` |
| inline | `thaqalayn:24/2/79/12` | خودکار طور پر پارس اور متن سے ہٹا دیا جاتا ہے |

---

## 🎨 ٹائپوگرافی

| استعمال | فونٹ |
|---|---|
| اردو UI اور جوابات | **Jameel Noori Nastaleeq** (مقامی WOFF2 سب سیٹ) |
| عربی متن / آیات | **Amiri** → Scheherazade New → Noto Naskh |
| لاطینی لیبلز | **Inter** |

**فونٹ پائپ لائن:** اصل TTF 10.8 MB / 19,658 glyphs ہے۔ Nastaleeq کو درست شیپنگ کے لیے
واقعی ~19k ligature glyphs درکار ہوتے ہیں (`rlig` ہٹانے سے صرف 402 glyphs بچتے ہیں مگر
نستعلیق ختم ہو جاتا ہے) — لہٰذا صرف غیر ضروری codepoints ہٹائے گئے اور Brotli/WOFF2 سے
کمپریس کیا گیا: **10.8 MB → 5.2 MB**، اور `font-display: swap` کی بدولت پہلی پینٹ کبھی
بلاک نہیں ہوتی۔

```bash
npm run fonts        # دوبارہ بنانے کے لیے (python + fonttools brotli)
```

ترتیبات میں *رسم الخط* تبدیل کر کے Noto Nastaliq / Naskh / سسٹم فونٹ بھی منتخب کیا جا سکتا ہے
(کم بینڈوِڈتھ والے کنکشنز کے لیے)۔

---

## 🔒 پرائیویسی

* API key اور گفتگویں **صرف اسی ڈیوائس** پر محفوظ ہوتی ہیں۔
* کوئی بیک اینڈ، ٹیلی میٹری یا اینالیٹکس نہیں۔
* صرف دو آؤٹ باؤنڈ کالز ہیں: **Google Gemini API** (آپ کی key سے) اور **Thaqalayn**
  (صرف اس وقت جب آپ کوئی حوالہ کھولیں)۔

---

## ⚠️ دستبرداری

SHAI فتویٰ نہیں دیتی۔ ہر جواب میں حوالہ جات خود کھول کر تصدیق کرنا آپ کی ذمہ داری ہے؛
تفصیلی فقہی احکام کے لیے اپنے مجتہدِ جامع الشرائط سے رجوع کریں۔

---

MIT License · ماخذ: [Thaqalayn](https://thaqalayn.com)
