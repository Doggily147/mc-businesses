# World Capture

Connects to your real Minecraft server as a bot, loads chunks around it, and exports a 2D vertical slice as `world.json` for the browser game (`play.html`) to render.

## What it does

1. Joins your server (`51.161.199.30:26410` by default) as username `bubbu`, MC version `1.21.11`
2. Sits at spawn for 15 seconds while the server streams chunks to it
3. Reads an 8-chunks-wide × 130-blocks-tall vertical slice through spawn
4. Writes `../world.json` (sibling of `play.html`)

The browser game (`play.js`) auto-fetches `world.json` on load and uses it instead of procedural gen. So **everyone playing the browser game sees your real server world**.

## Run it

```bash
cd world-capture
npm install
npm start
```

Wait ~20 seconds, see `✓ Wrote .../world.json`, done.

## Re-capture

Just run `npm start` again. The browser game re-fetches `world.json` on every page load, so refresh the page after re-capturing.

## Config

Edit the constants at the top of `capture.js`:

```js
const HOST = '51.161.199.30';
const PORT = 26410;
const VERSION = '1.21.11';
const USERNAME = 'bubbu';
const CHUNK_RADIUS = 4;       // 4 = 8 chunks across
const Y_MIN = 50;
const Y_MAX = 180;
```

## Limitations

- 2D slice only — captures one Z plane (the bot's spawn Z). The browser game is 2D.
- Static snapshot — doesn't live-sync. Re-run after server world changes.
- Bot's username (`bubbu`) will appear in your server's player list while capturing.
