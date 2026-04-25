# World Server

Local Node.js process. Two jobs in one:

1. **Joins your real Minecraft server** as a Mineflayer bot named `WorldSync`.
   Watches loaded chunks, block updates, and chat in real time.
2. **Runs a WebSocket server on `localhost:8080`** that the browser game
   (`play.html`) connects to. Streams everything live.

```
   Browser (play.html) ──ws://localhost:8080──> world-server (Node)
                                                      │
                                                      └── MC protocol → 51.161.199.30:26410
```

No Firebase, no third-party services. Just one Node process on your PC.

## Setup (one time)

```bash
cd world-server
npm install
```

## Run

```bash
npm start
```

You should see:
```
[boot]  Mineflayer connecting to 51.161.199.30:26410 as WorldSync (v1.21.11)...
[ws]    Listening on :8080
[bot]   Spawned at (...).
[chunk] sent 0,0
[chunk] sent 1,0
...
```

Leave it running. Then open `play.html` in your browser. The game connects to
`ws://localhost:8080` automatically and starts rendering your real server's
world in 3D.

## What the browser sees

- Every block within the bot's render distance, in real time
- Block changes: anyone breaking/placing on the real server shows up in your browser
- Chat from the real server
- Other browsers connected to the same world-server (multiplayer)

## What flows back to the real server

- Chat messages typed in the browser → bot says them on the real server
- Block break/place: NOT yet (browser-placed blocks only appear in browsers).
  To make browser-placed blocks persist on the real server, we'd need either
  RCON (separate `rcon-proxy` folder, partly built) or the bot to be opped
  + walking up to each location. Easier to add RCON.

## Config

Edit constants at the top of `server.js`:

```js
const HOST          = '51.161.199.30';
const PORT          = 26410;
const VERSION       = '1.21.11';
const BOT_USERNAME  = 'WorldSync';
const WS_PORT       = 8080;
const Y_MIN         = 50;       // capture range Y_MIN..Y_MAX only
const Y_MAX         = 180;
const CHUNK_RADIUS  = 4;        // 9x9 chunk area = "8 chunks loaded"
```

## Limitations (the honest list)

- **Bot username `WorldSync` will be visible** in your server's player list.
  Anyone /list-ing the server sees it. To hide: rename or whitelist.
- **No textures yet** — blocks are solid colors based on their name.
- **Block placement from browser doesn't persist** on the real server (see above).
- **Server has to allow Mineflayer** — should work since you're in offline mode.
