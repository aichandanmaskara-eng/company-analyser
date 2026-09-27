# 📊 Company Analyser — Online edition

A web app for **phones, tablets and computers**. It analyses the published results of any listed company: ratios, section-wise insights, peer comparison, smart Excel/CSV upload, and light, dark and pro themes. It works in any modern browser and can be added to a phone's home screen like an app.

| Part | Built with |
|---|---|
| Server | **Python 3 + FastAPI** (async web framework) and **curl_cffi** (talks to Yahoo Finance) |
| Browser app | HTML5, CSS3 and JavaScript, with **Apache ECharts** (interactive, touch-friendly charts), **SortableJS** (drag and drop that works on phones), **SheetJS** (reads Excel files in the browser) and the **Inter** font |
| Mobile | Responsive layout; installable web app (manifest and service worker); QR code to open it on a phone |

---

## Option A: use it on your Wi-Fi (no accounts needed)

1. Double-click **`Start on Wi-Fi.bat`**. It installs the three Python packages the first time.
2. The app opens on this computer. The black window shows a second address, like `http://192.168.1.15:8000/`.
3. On your phone, **connect to the same Wi-Fi** and open that address, or click **📱 Phone** in the app and scan the QR code.
4. If Windows asks *"Allow Python to communicate on networks?"*, choose **Private networks** only.

Keep the black window open while people use the app. It only works while this PC is on and connected to that network.

---

## Option B: publish it on the internet (free)

You'll get an address like `https://company-analyser.onrender.com` that works on any phone or PC, anywhere.

### 1. Put the code on GitHub (about 5 minutes, all in the browser)

1. Create a free account at **github.com** and sign in.
2. Click **+ → New repository**. Name it `company-analyser`, choose **Public** or **Private**, then click **Create repository**.
3. On the new page, click **"uploading an existing file"**.
4. Open the `Company Analyser Online` folder on your PC and **drag in everything inside it**: the `app` and `static` folders plus all the files. You can skip the `data_cache` and `tools` folders.
5. Click **Commit changes**.

### 2. Put it online with Render (about 5 minutes)

1. Create a free account at **render.com** using **"Sign in with GitHub"**.
2. Click **New + → Blueprint**, choose your `company-analyser` repository, then click **Apply**.
   (Render reads `render.yaml` and sets everything up for you.)
3. Wait for the build to finish (2–4 minutes). Your web address appears at the top of the page, so share it.

**Good to know about the free plan**
- The app **sleeps after 15 minutes without visitors**. The first visit after that takes about 30–60 seconds to wake it up.
- Saved companies are cleared when it restarts. They are downloaded again automatically when someone looks them up.
- Yahoo Finance sometimes limits requests from cloud servers. If a company won't load, wait a minute and try again.

Other hosts also work. The included `Dockerfile` runs on Railway, Fly.io, Google Cloud Run or Hugging Face Spaces.

---

## 📱 Install it on a phone

- **iPhone (Safari):** tap **Share → Add to Home Screen**.
- **Android (Chrome):** tap **⋮ → Install app** (or *Add to Home screen*).

Installing works fully on the internet address (https). On a Wi-Fi address (http) you can still add a home-screen shortcut.

## 🔗 Sharing a view
**🔗 Share** creates a link that opens the same companies and page, for example:
`https://…/#load=TCS.NS,INFY.NS&tab=compare`

## 🔒 Privacy and data
- Files you upload in **Smart Upload** are read **inside your browser**. They are never sent to the server.
- Company data comes from Yahoo Finance and may differ slightly from filed reports, so check important figures.
- For analysis and education only. This is not investment advice.

## For developers
- `app/main.py` holds the API routes (`/api/search`, `/api/company`, `/api/fx`, `/api/status`) and basic rate limiting.
- `app/data.py` is the Yahoo Finance client, with caching and single-flight downloads.
- `static/`: the browser app. `app.js` and `app.css` are generated from the desktop `dashboard.html` by `tools/build_frontend.py`. `charts.js` is the ECharts chart engine.
- To run it locally: `python run_local.py` (Wi-Fi) or `uvicorn app.main:app --reload`.
