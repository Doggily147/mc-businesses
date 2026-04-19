# MC Server Businesses

A static website (free, hosted on GitHub Pages) that catalogs Minecraft server businesses, their purchase logs, and projects investment growth in iron/diamond/etc.

## Features

- 🔍 **Search** businesses by name, owner, category, or keyword
- 📊 **Portfolio pages** for each business — stats, ledger, growth chart
- 💰 **Purchase ledger** — businesses log who bought what and the price
- 📈 **Investment projection** — see what 1, 8, 32 iron/diamonds become if reinvested
- 👤 **Login system** — register and log into your business owner account
- ✏️ **Owner controls** — log purchases directly through the site once logged in

## Login system (heads up)

Because GitHub Pages is **static-only** (no server, no database), accounts are stored in your browser's localStorage. That means:

- Your account works on the device/browser you create it on
- Logging out and back in works
- Switching browsers = needs to re-register
- This is "fake but useful" auth — fine for a Minecraft community tool

**Want real cross-device accounts?** Plug in [Firebase Authentication](https://firebase.google.com/docs/auth) (free tier) — it's a 30-line drop-in replacement for the auth functions in `app.js`. Open an issue and I'll wire it up.

## Adding a business permanently

Owners can register businesses through the site (saved to localStorage). To make a business **public for everyone**, edit `businesses.json` directly via GitHub's web editor and commit:

```json
{
  "id": "my-shop",
  "name": "My Shop",
  "owner": "MyMinecraftName",
  "founded": "2026-04-19",
  "category": "Materials",
  "description": "What I sell.",
  "baseCurrency": "diamond",
  "investmentRate": 0.05,
  "purchases": []
}
```

## Repo layout

```
mc-businesses/
├── index.html         Search + business cards
├── business.html      Single business portfolio
├── styles.css         Theme
├── app.js             Login, search, business list
├── business.js        Business detail page logic
├── businesses.json    Public business directory data
└── README.md          (this file)
```

## Run locally

Static site, no build step:

```bash
# Just serve the folder with anything that hosts files
python -m http.server 8000
# then open http://localhost:8000
```

## Deploy

Already deployed on GitHub Pages. To redeploy after edits:

```bash
git add .
git commit -m "update"
git push
```

Pages auto-rebuilds in ~30 seconds.
