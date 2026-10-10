# 📱 SHAI — Android APK بنانے کی مکمل ہدایات

یہ دستاویز بتاتی ہے کہ SHAI کو ایک انسٹال ہونے والی `.apk` فائل میں کیسے بدلا جائے۔
Capacitor کا Android پروجیکٹ **پہلے ہی ریپو میں موجود اور کنفیگر ہے** (`android/`)۔

---

## 0 · اہم نوٹ (اس sandbox کے بارے میں)

یہ ڈیولپمنٹ sandbox **JDK اور Android SDK کے بغیر** ہے، اس لیے یہاں `.apk` فائل compile نہیں
کی جا سکتی (Gradle کو Java + `android.jar` چاہیے)۔ جو کچھ تیار کر کے دیا گیا ہے:

| چیز | حالت |
|---|---|
| `android/` Capacitor پروجیکٹ | ✅ موجود (`npx cap add android` سے بنایا گیا) |
| App ID / نام / آئیکن / splash | ✅ `net.shai.app`، "SHAI"، branded icons |
| Gradle کنفیگریشن | ✅ Capacitor 7 / AGP 8.x |
| `scripts/build-apk.sh` | ✅ debug / release / signed |
| `.github/workflows/apk.yml` | ✅ CI پر APK بلڈ + artifact |
| `dist/` ویب بنڈل | ✅ `npm run build` سے بنتا ہے |

**نتیجہ:** اپنی مشین پر صرف ایک کمانڈ چلانی ہے (نیچے دیکھیں) — یا GitHub پر push کریں،
CI خود APK بنا دے گا۔

---

## 1 · مقامی مشین پر ضروری سامان

| ضرورت | کم از کم | چیک |
|---|---|---|
| **Node.js** | 20+ | `node -v` |
| **JDK** | 17 | `java -version` |
| **Android SDK** | API 35 + build-tools | `echo $ANDROID_HOME` |
| **Android Studio** (اختیاری) | Ladybug+ | — |

### Android SDK انسٹال کرنا

Android Studio انسٹال کریں → **Settings → SDK Manager** → ان کے نشان لگائیں:

* Android SDK Platform **35** (Android 15)
* Android SDK Build-Tools **35.x**
* Android SDK Command-line Tools
* Android SDK Platform-Tools

پھر `~/.bashrc` / `~/.zshrc` میں شامل کریں:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"        # macOS: ~/Library/Android/sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

اور `android/local.properties` بنائیں (اس فائل کو **کبھی commit نہ کریں** — پہلے ہی `.gitignore` میں ہے):

```properties
sdk.dir=/home/<آپ کا یوزر>/Android/Sdk
```

---

## 2 · ایک کمانڈ میں APK

```bash
git clone <repo> && cd shai
npm install

npm run apk:debug          # → build/SHAI-debug.apk
```

اسکرپٹ خود بخود:
1. `npm ci` / `npm install`
2. `npm run build` (Vite → `dist/`)
3. `npx cap sync android` (ویب اثاثے → `android/app/src/main/assets/public`)
4. `./gradlew assembleDebug`
5. APK کو `build/SHAI-debug.apk` میں کاپی

### ڈیوائس پر انسٹال

```bash
adb install -r build/SHAI-debug.apk
# یا
adb devices && adb -s <serial> install -r build/SHAI-debug.apk
```

---

## 3 · Release APK

### 3a · Unsigned (جلدی جانچ کے لیے)

```bash
npm run apk:release        # → build/SHAI-release-unsigned.apk
```

### 3b · Signed (Play Store / تقسیم کے لیے)

```bash
# ایک بار keystore بنائیں (اسے محفوظ رکھیں، کھو دیا تو اپ ڈیٹ نہیں دے سکیں گے)
keytool -genkey -v -keystore shai-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias shai

# پھر
export KEYSTORE_FILE="$PWD/shai-release.jks"
export KEYSTORE_PASSWORD='****'
export KEY_ALIAS='shai'
export KEY_PASSWORD='****'

bash scripts/build-apk.sh release signed    # → build/SHAI-release.apk
```

> `*.jks` اور `keystore.properties` پہلے ہی `.gitignore` میں ہیں — کبھی commit نہ کریں۔

### App Bundle (`.aab`) — Play Store کے لیے

```bash
npx cap sync android && ./android/gradlew -p android bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

---

## 4 · GitHub Actions (بغیر کسی مقامی سیٹ اپ کے)

`.github/workflows/apk.yml` خودکار طور پر:

1. `npm run test` (111 assertions)
2. ویب بنڈل + `cap sync`
3. `assembleDebug` اور `assembleRelease`
4. دونوں APK کو artifact کے طور پر اپ لوڈ (30 دن)

**چلانے کا طریقہ:**

```bash
git push origin main                 # → Actions ٹیب میں "SHAI-APK" artifact
# یا ریلیز کے لیے:
git tag v1.0.0 && git push --tags    # → APK خود GitHub Release میں attach
```

---

## 5 · Android پروجیکٹ میں کیا کیا گیا ہے

```
android/
├── app/src/main/
│   ├── AndroidManifest.xml      # launcher activity, RTL support
│   ├── res/                     # branded launcher icons (adaptive) + splash
│   └── assets/public/           # ← cap sync خود بھرتا ہے (gitignored)
├── app/build.gradle             # applicationId net.shai.app, versionName 1.0.0
├── variables.gradle             # minSdk 23, targetSdk 35
└── gradlew                      # Gradle wrapper
```

* **App ID:** `net.shai.app`
* **App name:** `SHAI`
* **minSdk:** 23 (Android 6+) · **targetSdk:** 35
* **Deep links:** حوالہ جات Capacitor Browser (in-app browser) میں کھلتے ہیں
* **Status bar / keyboard:** `@capacitor/status-bar` اور `@capacitor/keyboard` کنفیگر
* **Back button:** اوپن overlay / سائیڈبار کو بند کرتا ہے، ورنہ ایپ سے باہر

---

## 6 · ڈیولپمنٹ ورک فلو

```bash
npm run dev            # ویب پر live reload  → http://localhost:5173
npm run build          # پروڈکشن بنڈل → dist/
npm run cap:sync       # build + Android میں کاپی
npm run cap:open       # Android Studio میں کھولیں
```

ویب ایپ میں تبدیلی کے بعد صرف `npm run cap:sync` چلائیں — Android Studio دوبارہ Run کریں۔

---

## 7 · مسائل کا حل

| مسئلہ | حل |
|---|---|
| `SDK location not found` | `android/local.properties` بنائیں یا `ANDROID_HOME` سیٹ کریں |
| `Unsupported class file major version` | JDK 17 انسٹال کریں (`java -version` چیک کریں) |
| `npm ci` fails | `package-lock.json` موجود ہے؟ ورنہ `npm install` چلائیں |
| APK انسٹال نہیں ہوتا | ڈیوائس پر *Unknown sources* کی اجازت دیں، پرانی انسٹال ان انسٹال کریں |
| ایپ میں خالی صفحہ | `npx cap sync android` دوبارہ چلائیں اور Android Studio سے *Clean Project* |
| فونٹ بہت بھاری لگتا ہے | ترتیبات → رسم الخط → *Noto Nastaliq Urdu* منتخب کریں |
| `gradlew: Permission denied` | `chmod +x android/gradlew` |

---

## 8 · بلڈ کے بعد چیک لسٹ

- [ ] ایپ کھولیں → splash کے بعد welcome نظر آئے
- [ ] Setup modal میں *Get API Key* پر ٹیپ → AI Studio کھلے
- [ ] Key paste کریں → تصدیق ہو → چیٹ ان لاک
- [ ] کوئی سوال پوچھیں → جواب streaming میں آئے
- [ ] حوالہ جات کے لنکس پر ٹیپ → Thaqalayn in-app browser میں کھلے
- [ ] تاریک / روشن دونوں میں اردو نستعلیق درست نظر آئے
- [ ] سائیڈبار سے نئی گفتگو اور ڈیلیٹ کام کریں
