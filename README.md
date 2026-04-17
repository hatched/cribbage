# 🃏 Crib

A two-player cribbage game that runs entirely in the browser. No server required — players connect peer-to-peer via WebRTC using [PeerJS](https://peerjs.com/).

## How to play

1. **Player A** opens the app and taps **Start Game** — a 4-letter code appears.
2. **Player B** opens the app, taps **Join Game**, and enters the code.
3. Once connected the game begins automatically.

All game state is sent directly between browsers; the PeerJS cloud service is only used for the initial handshake.

---

## Deploying to GitHub Pages

### 1. Create a GitHub repository

Go to [github.com/new](https://github.com/new) and create a new **public** repository (e.g. `crib`).

### 2. Push the files

From inside this directory:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/crib.git
git push -u origin main
```

### 3. Enable GitHub Pages

1. Open your repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Source**, select **Deploy from a branch**.
4. Set **Branch** to `main` and folder to `/ (root)`.
5. Click **Save**.

GitHub will give you a URL like:

```
https://YOUR_USERNAME.github.io/crib/
```

It usually goes live within a minute or two.

---

## Local development

Because the app uses ES modules you need to serve the files over HTTP rather than opening `index.html` directly from the filesystem. The easiest options:

```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx, no install needed)
npx serve .

# VS Code
# Install the "Live Server" extension and click "Go Live"
```

Then open `http://localhost:8080` in two browser tabs to test both sides of a game locally.

---

## Rules implemented

- Full 6-card deal, 2-card discard to the crib
- Non-dealer cuts for the starter card (His Heels scores 2 for dealer if it's a Jack)
- Pegging with correct scoring: fifteens, pairs, three/four of a kind, runs, 31, last card, Go
- Show scoring: fifteens, pairs, runs (including double/triple runs), flushes, Nobs
- Non-dealer counts first, then dealer's hand, then crib
- Dealer rotates each hand
- First to **121** wins

---

## Tech stack

| Piece | Technology |
|---|---|
| UI | Vanilla HTML / CSS / JS (ES modules) |
| Peer discovery | [PeerJS 1.5](https://peerjs.com/) via CDN |
| Transport | WebRTC DataChannel (P2P after handshake) |
| Hosting | GitHub Pages (static files, zero backend) |