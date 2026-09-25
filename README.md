# Rotina

A personal routine journal (movement, sleep, energy, food) that installs on the iPhone home screen as a full-screen app. Works offline, saves on every tap, and can sync to your own Google Sheet.

No personal data lives in this repo. Your weekly plan, gyms, activities and every logged day are stored on your phone and, if you connect it, in your Google Sheet.

## How it works

```
iPhone app ──saves instantly──▶ phone storage (IndexedDB, works offline)
     │
     └──syncs when online──▶ your Google Sheet + a Drive folder for attachments
```

- **Plain HTML/CSS/JS, no build step.** `index.html` + `css/` + `js/` (ES modules).
- **`sw.js`** caches the whole app, so it opens instantly and works in airplane mode.
- **`apps-script/Code.gs`** is a small script that runs inside your Google Sheet and receives the data. Nothing else, no server to pay for.

## 1. Publish it (GitHub Pages, free)

1. Merge this branch into `main`.
2. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`** → Save.
3. After a minute the app is live at `https://<your-user>.github.io/healthyhabits/`.

## 2. Install on the iPhone

1. Open that link in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. From now on, always open it from the home-screen icon.

> ⚠️ The installed app has its own storage, separate from Safari. **Deleting the home-screen icon deletes the data on the phone.** Connect the Google Sheet (below) or export a backup first.

## 3. Connect your Google Sheet (≈5 min, recommended)

This gives you automatic backup, lets you open your data in Sheets, and lets Claude read it (via the Google Drive connector) to give you feedback and plans.

1. Create a new Google Sheet (e.g. "Rotina").
2. **Extensions → Apps Script**. Delete what's there and paste the contents of [`apps-script/Code.gs`](apps-script/Code.gs). Save.
3. In the function dropdown pick **`setup`** → **Run**. Accept the permissions (it's your own script).
   Open **Execution log**: it prints **"Seu código secreto: …"**. Copy it.
4. **Deploy → New deployment →** gear icon **→ Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   → **Deploy**, and copy the **Web app URL** (ends in `/exec`).
5. In the app: **⚙ Ajustes → planilha google**, paste the URL and the secret code, and tap **conectar**.

"Anyone" only means the URL is reachable. Every request must include your secret code, and the script only touches this one Sheet and one Drive folder ("Rotina — anexos").

The **Checkins** tab gets one readable row per day (activities, energy, sleep hours, food, links to attachments). The **Config** tab holds your plan and activity list.

## 3b. Lifesum → Apple Health → Rotina (optional)

An iPhone Shortcut reads the day's calories, protein, carbs, fat and water from Apple Health (where Lifesum writes them) and sends them to a **Saúde** tab in your Sheet every night. The app shows them in the **comida** section. Step-by-step guide (in Portuguese): [`docs/atalho-saude.md`](docs/atalho-saude.md).

Any watch whose iPhone app writes to Apple Health can later feed sleep and workouts through the same route.

**Updating the script:** when `apps-script/Code.gs` changes, paste the new version into Apps Script, save, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (the URL stays the same). Run `setup` again if new tabs were added.

## 4. Your plan and activities

Set these in the app under **⚙ Ajustes**: weekly plan, activities per category, and weekly targets. Or paste a ready-made config under **backup → colar configuração**. They sync to the Sheet like everything else.

## Backups

**Ajustes → exportar backup** creates one `.json` file with everything (days, plan, attachments). Choose **Save to Files → iCloud Drive**. **importar** restores it on a new phone. Import also accepts day records exported from the old claude.ai version.

If the Sheet isn't connected, the app reminds you weekly to export a backup.

## Updating the app

After changing any file, bump `VERSION` in `sw.js` (and `VERSION` in `js/app.js`). Installed phones then show **"versão nova disponível → atualizar"** the next time the app is opened.

## iOS limits worth knowing

- No automatic install prompt; you add it once through Safari's Share menu.
- No scheduled local notifications. For a daily "log your day" reminder, use a Shortcuts automation that opens the app.
- No access to Apple Health / Watch data; sleep is entered by hand.
- Nothing runs in the background. Sync happens while the app is open.

## Credits

Fonts: [Fraunces](https://github.com/undercasetype/Fraunces) and [Outfit](https://github.com/Outfitio/Outfit-Fonts), SIL Open Font License (see `assets/fonts/`). Illustrations cut from the Healthy Habits logo artwork.
