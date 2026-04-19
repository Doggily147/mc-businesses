# MC Server Businesses

Static website cataloging Minecraft server businesses, purchase ledgers, and reinvestment growth projections. Backed by **Firebase** for real cross-device accounts + cloud-synced data, hosted on **Cloudflare Pages** (free, supports private repos).

## Features

- 🔍 Search businesses by name, owner, category
- 📊 Per-business portfolio (stats, ledger, growth chart)
- 💰 Purchase ledger
- 📈 Compound-interest investment projection
- 👤 Real Firebase email/password accounts (cross-device, real password resets)
- ✏️ Owner-only purchase logging
- ☁️ Firestore-backed data (everyone sees the same businesses)

---

## 🔥 Firebase setup (5 minutes, one time)

1. Go to https://console.firebase.google.com → **Add project** → name it `mc-businesses` → disable Analytics → Create.
2. In the project, click the **Web** icon (`</>`) to add a web app → nickname `mc-businesses-web` → **Register app** (don't enable hosting).
3. You'll see a `firebaseConfig` block. Copy the values into **`firebase-config.js`** in this repo.
4. Left sidebar → **Build → Authentication → Get started** → enable **Email/Password** sign-in.
5. Left sidebar → **Build → Firestore Database → Create database** → Production mode → pick a region → Done.
6. Firestore → **Rules** tab → paste this and Publish:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // Anyone signed in can read businesses; only the owner can write/update
       match /businesses/{bizId} {
         allow read: if true;
         allow create: if request.auth != null
                       && request.resource.data.owner == request.auth.uid;
         allow update, delete: if request.auth != null
                       && resource.data.owner == request.auth.uid;
       }
       // Username uniqueness lookup
       match /usernames/{name} {
         allow read: if true;
         allow create: if request.auth != null
                       && request.resource.data.uid == request.auth.uid;
       }
     }
   }
   ```

7. Authentication → **Templates** tab → "Password reset" → optionally customize the from-name. Firebase auto-sends these emails when a user clicks "Forgot my password" — no setup needed.

That's it. Reload the site, sign up, and you have real cross-device accounts.

> The values in `firebase-config.js` are **safe to commit publicly**. Security comes from the Firestore rules above, not from hiding the config.

---

## ☁️ Hosting on Cloudflare Pages (private repo, public site, free)

GitHub Pages requires a Pro plan ($4/mo) to publish a private repo. Cloudflare Pages does it free.

1. Make the GitHub repo private: GitHub → repo → Settings → bottom → "Change visibility" → Private.
2. Go to https://dash.cloudflare.com → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
3. Authorize Cloudflare to read your private repo, pick `mc-businesses`.
4. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `/`
5. Save and Deploy. You get a public URL like `https://mc-businesses.pages.dev`.
6. Every `git push` auto-redeploys in ~30 seconds.

Optional: add a custom domain under Pages → Custom domains.

---

## Local dev

```bash
python -m http.server 8000
# open http://localhost:8000
```

For Firebase to work locally, your localhost domain is auto-allowed in Auth → Settings → Authorized domains.

## Files

```
mc-businesses/
├── index.html            Search + business cards
├── business.html         Single business portfolio
├── styles.css            Theme
├── app.js                Auth + business loading (Firebase-backed)
├── business.js           Business detail page logic
├── businesses.json       Seed data (auto-uploaded to Firestore on first run)
├── firebase-config.js    YOUR Firebase project keys (edit this)
└── README.md
```

## Fallback mode

If `firebase-config.js` isn't filled in, the site falls back to localStorage-only mode (per-browser accounts, mailto password reset). Useful for offline tinkering.
