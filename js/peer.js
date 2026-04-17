// js/peer.js
// PeerJS connection wrapper — host gets a 4-letter room code,
// guest connects to it. After handshake all game data is P2P.

// Letters that are visually unambiguous (no I, O)
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

// ─── ICE / TURN configuration ─────────────────────────────────────────────────
// STUN alone is not enough when either player is on mobile data (carrier-grade
// NAT) or behind a strict firewall — a TURN relay is required in those cases.
//
// HOW TO ADD FREE TURN (takes ~2 minutes):
//   1. Sign up free at https://dashboard.metered.ca/signup
//   2. Go to TURN → ICE Server Credentials in the dashboard
//   3. Replace the placeholder object below with the credentials they provide
//
// The final iceServers array should look roughly like:
//   { urls: "stun:stun.relay.metered.ca:80" },
//   { urls: "turn:global.relay.metered.ca:80",       username: "xxx", credential: "yyy" },
//   { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "xxx", credential: "yyy" },
//   { urls: "turn:global.relay.metered.ca:443",      username: "xxx", credential: "yyy" },
//   { urls: "turn:global.relay.metered.ca:443?transport=tcp", username: "xxx", credential: "yyy" },
const ICE_CONFIG = {
  // iceCandidatePoolSize pre-gathers STUN (srflx) candidates before the
  // connection starts. Without this, the mDNS-obfuscated host candidate is
  // sent first and fails fast, and the real public-IP srflx candidate arrives
  // too late via trickle ICE — ICE gives up before ever trying the good pair.
  iceCandidatePoolSize: 4,
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // ↓ Paste your Metered.ca TURN credentials here if srflx still fails ↓
    // { urls: "turn:global.relay.metered.ca:80", username: "YOUR_USERNAME", credential: "YOUR_CREDENTIAL" },
    // { urls: "turn:global.relay.metered.ca:443", username: "YOUR_USERNAME", credential: "YOUR_CREDENTIAL" },
    // { urls: "turn:global.relay.metered.ca:443?transport=tcp", username: "YOUR_USERNAME", credential: "YOUR_CREDENTIAL" },
  ],
};

let _peer = null; // local PeerJS instance
let _conn = null; // active DataConnection
let _isHost = false;
let _onMessage = null;
let _onDisconn = null;

// ─── Code generation ──────────────────────────────────────────────────────────

function genCode() {
  return Array.from(
    { length: 4 },
    () => CHARS[Math.floor(Math.random() * CHARS.length)],
  ).join("");
}

// ─── Host ─────────────────────────────────────────────────────────────────────

/**
 * Start hosting.
 * @param {(code: string) => void}   onCode       Called with the 4-letter room code once registered.
 * @param {() => void}               onConnect    Called when a guest successfully connects.
 * @param {(msg: object) => void}    onMessage    Called for every message received from the peer.
 * @param {(reason: string) => void} onDisconnect Called if the connection drops or errors.
 */
export function initHost(onCode, onConnect, onMessage, onDisconnect) {
  _isHost = true;
  _onMessage = onMessage;
  _onDisconn = onDisconnect;

  _tryHostWithCode(genCode(), onCode, onConnect);
}

function _tryHostWithCode(code, onCode, onConnect) {
  _onDisconn = null;

  if (_peer && !_peer.destroyed) {
    try {
      _peer.destroy();
    } catch (_) {}
  }

  _conn = null;

  _peer = new Peer(code, { config: ICE_CONFIG });

  _peer.on("open", () => {
    onCode(code);
  });

  _peer.on("connection", (conn) => {
    _conn = conn;
    _setupConn(onConnect);
  });

  _peer.on("error", (err) => {
    if (err.type === "unavailable-id") {
      // Code already taken — silently try a new one
      _tryHostWithCode(genCode(), onCode, onConnect);
    } else {
      console.error("[peer] host error", err.type, err);
      _onDisconn?.(err.message ?? err.type ?? "Unknown error");
    }
  });

  _peer.on("disconnected", () => {
    if (!_peer.destroyed) {
      try {
        _peer.reconnect();
      } catch (_) {}
    }
  });
}

// ─── Guest ────────────────────────────────────────────────────────────────────

/**
 * Join an existing game.
 * @param {string}                   code         4-letter room code (case-insensitive).
 * @param {() => void}               onConnect    Called when connected to the host.
 * @param {(msg: object) => void}    onMessage    Called for every message received from the peer.
 * @param {(reason: string) => void} onDisconnect Called if the connection drops or errors.
 */
export function initGuest(code, onConnect, onMessage, onDisconnect) {
  _isHost = false;
  _onMessage = onMessage;

  // Null out handlers BEFORE destroying old peer so that any close/error
  // events that fire during cleanup don't call the new disconnect handler.
  _onDisconn = null;

  if (_peer && !_peer.destroyed) {
    try {
      _peer.destroy();
    } catch (_) {}
  }

  _conn = null;

  // Now safe to set the real handler — old peer is gone.
  _onDisconn = onDisconnect;

  _peer = new Peer({ config: ICE_CONFIG });

  _peer.on("open", () => {
    _conn = _peer.connect(code.toUpperCase().trim(), { reliable: true });
    _setupConn(onConnect);
  });

  _peer.on("error", (err) => {
    console.error("[peer] guest error", err.type, err);
    const msg =
      err.type === "peer-unavailable"
        ? `Game code "${code.toUpperCase()}" not found. Check the code and try again.`
        : (err.message ?? err.type ?? "Connection error");
    _onDisconn?.(msg);
  });
}

// ─── Shared connection setup ──────────────────────────────────────────────────

function _setupConn(onConnect) {
  _conn.on("open", () => {
    onConnect();
  });

  _conn.on("data", (data) => {
    try {
      const msg = typeof data === "string" ? JSON.parse(data) : data;
      _onMessage?.(msg);
    } catch (err) {
      console.error("[peer] failed to parse incoming message", err, data);
    }
  });

  _conn.on("close", () => {
    _onDisconn?.("Opponent disconnected.");
  });

  _conn.on("error", (err) => {
    console.error("[peer] connection error", err);
    _onDisconn?.(err.message ?? "Connection error");
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a message object to the peer. No-op if not connected.
 * @param {object} msg
 */
export function send(msg) {
  if (_conn?.open) {
    _conn.send(JSON.stringify(msg));
  } else {
    console.warn("[peer] send() called but connection is not open", msg);
  }
}

/** Returns true if this client is the host. */
export function isHost() {
  return _isHost;
}

/** Tear down the connection and local peer. */
export function disconnect() {
  try {
    _conn?.close();
  } catch (_) {}
  try {
    _peer?.destroy();
  } catch (_) {}
  _conn = null;
  _peer = null;
}
