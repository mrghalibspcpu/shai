# SHAI - شیعہ حدیث AI (Mobile App)

معتبر شیعہ کتب (الکافی، من لا یحضرہ الفقیہ، تہذیب الاحکام، نہج البلاغہ، الخصال، عیون اخبار الرضا، کمال الدین، الأمالی، کتاب التوحید) کی احادیث، عربی متن اور اردو ترجمے کے ساتھ۔

**Features**
- 9 کتب، 42,000+ احادیث، ابواب کے ساتھ براؤز کریں
- اردو اور عربی میں تلاش (تمام کتب یا ایک کتاب میں)
- ★ بُک مارک، کاپی، شیئر
- AI کے بنائے ہوئے اردو خلاصے (تفصیل کے لیے کھولیں)
- متن کا سائز اور ڈارک تھیم
- آف لائن کام کرتی ہے (پہلی بار کھولنے کے بعد)
- Android اور iPhone پر ہوم اسکرین پر انسٹال ہو جاتی ہے (PWA)

## 1. چلانے کے لیے

یہ ایک static PWA ہے، کوئی backend نہیں چاہیے۔ کسی بھی HTTPS hosting پر `app/` فولڈر اپلوڈ کریں، جیسے:
- **Netlify Drop**: https://app.netlify.com/drop پر `app/` فولڈر ڈریگ کریں
- **GitHub Pages**: ریپو میں `app/` کو Pages کے ذریعے publish کریں
- **لوکل ٹیسٹ**: `cd app && python3 -m http.server 8000` پھر `http://localhost:8000`

> Service Worker اور انسٹال کے لیے HTTPS (یا localhost) ضروری ہے۔

## 2. موبائل پر انسٹال

- **Android (Chrome)**: سائٹ کھولیں → مینو (⋮) → *Install app* / *Add to Home screen*
- **iPhone (Safari)**: سائٹ کھولیں → شیئر (↑) → *Add to Home Screen*

## 3. APK بنانا (Android)

ایپ خود APK نہیں بناتی، لیکن PWA کو APK/AAB میں بدلنا آسان ہے:

**آسان طریقہ (PWABuilder)**
1. HTTPS پر ہوسٹ شدہ URL لیں (مثلاً `https://your-site.netlify.app`)
2. https://www.pwabuilder.com پر URL درج کریں
3. *Package for stores* → *Android* → *Generate package* → APK/AAB ڈاؤن لوڈ کریں

**CLI طریقہ (Bubblewrap)**
```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://your-site.netlify.app/manifest.webmanifest
bubblewrap build        # app-release-signed.apk بنتی ہے
```
(پہلی بار Android SDK اور JDK درکار ہوں گے، Bubblewrap انہیں انسٹال کرنے میں مدد کرتا ہے۔)

Play Store پر شائع کرنے کے لیے signed AAB اور Google Play Console اکاؤنٹ چاہیے۔

## 4. ڈیٹا اور ذمہ داری

- ماخذ: [ThaqalaynData](https://github.com/narmafraz/ThaqalaynData) (CC0 1.0 - عوامی ملکیت)، عربی متن اور احادیث کی ترتیب اسی سے لی گئی ہے۔
- **اردو ترجمے اور خلاصے AI سے تیار کیے گئے ہیں** اور ان کی علمی تصدیق نہیں ہوئی۔ شرعی مسائل کے لیے عربی متن کو بنیادی حوالہ سمجھیں اور مستند علماء سے رجوع کریں۔
- کتب کے اردو نام ہم نے خود لکھے ہیں۔

## 5. فولڈر کا ڈھانچہ

```
app/
├── index.html            # ایپ کا ڈھانچہ
├── style.css             # ڈیزائن، RTL، ڈارک تھیم
├── app.js                # روٹنگ، تلاش، بُک مارک، ترتیبات
├── sw.js                 # آف لائن کیش (Service Worker)
├── manifest.webmanifest  # PWA انسٹال کی معلومات
├── icons/                # ایپ آئیکن
├── fonts/                # Jameel Noori Nastaleeq (woff2 subset)
└── data/                 # index.json + ہر کتاب کی .json.gz فائل
```

### ڈیٹا دوبارہ بنانا / نئی کتاب شامل کرنا
ڈیٹا ایک JSON شکل میں ہے:
```json
{ "id": "book-id", "title": {"ar": "", "en": "", "ur": ""},
  "chapters": [ { "id": "...", "title": {"ar": "", "ur": "", "en": ""},
     "hadith": [ { "id": "book-id:1:1:1", "ar": "...", "ur": "...", "s": "خلاصہ (اختیاری)" } ] } ] }
```
اسے gzip کر کے `data/<book-id>.json.gz` کے طور پر رکھیں اور `data/index.json` میں اندراج شامل کریں۔ نیا ڈیٹا آنے پر `sw.js` میں `CACHE` کا ورژن بدلیں تاکہ پرانا کیش صاف ہو۔
