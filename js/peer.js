// js/peer.js
// PeerJS connection wrapper — host gets a 4-letter room code, guest connects.
//
// THE CORE FIX — patching RTCPeerConnection.setLocalDescription:
//
// Root cause of ICE failures: modern browsers replace local IPs with mDNS
// hostnames (e.g. "a3f8.local"). Cross-network, these can't be resolved, so
// the mDNS host candidate fails *instantly*. With trickle ICE, this is the
// first (and often only) candidate pair formed — ICE declares failure before
// the srflx (real public-IP / STUN) candidate has been trickled to the remote
// peer and paired.
//
// Fix: intercept setLocalDescription and don't return until iceGatheringState
// is "complete". PeerJS registers its onicecandidate handler *before* calling
// setLocalDescription, so during our wait every candidate (mDNS + srflx) is
// sent via PeerJS's trickle mechanism. By the time the offer/answer SDP
// reaches the remote peer, it already has all candidates queued — both pairs
// are formed from the start, and the srflx↔srflx pair succeeds.

(function patchRTCForCompleteGathering() {
  const _orig = RTCPeerConnection.prototype.setLocalDescription;

  RTCPeerConnection.prototype.setLocalDescription = async function (...args) {
    // Let the browser set the local description and start gathering.
    await _orig.apply(this, args);

    // If gathering already finished (e.g. no STUN servers, host-only) just
    // continue immediately.
    if (this.iceGatheringState === "complete") return;

    await new Promise((resolve) => {
      // Safety net: if gathering never completes (unreachable STUN, closed
      // connection, etc.) don't hang forever — continue after 8 s with
      // whatever candidates we have.
      const timer = setTimeout(resolve, 8000);

      const done = () => {
        if (
          this.iceGatheringState === "complete" ||
          this.connectionState === "closed" ||
          this.connectionState === "failed"
        ) {
          clearTimeout(timer);
          this.removeEventListener("icegatheringstatechange", done);
          this.removeEventListener("connectionstatechange", done);
          resolve();
        }
      };

      this.addEventListener("icegatheringstatechange", done);
      this.addEventListener("connectionstatechange", done);
    });
  };
})();

// ─── Config ───────────────────────────────────────────────────────────────────

// Letters that are visually unambiguous (no I, O).
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

// Two reliable Google STUN servers.
// With the setLocalDescription patch above we no longer need TURN for typical
// home/mobile networks — the srflx (public-IP) candidates are exchanged before
// ICE starts checking, so the srflx↔srflx pair gets tried and succeeds.
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// ─── State ────────────────────────────────────────────────────────────────────

let _peer = null; // local PeerJS Peer instance
let _conn = null; // active DataConnection
let _isHost = false;
let _onMessage = null;
let _onDisconn = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genCode() {
  return Array.from(
    { length: 4 },
    () => CHARS[Math.floor(Math.random() * CHARS.length)],
  ).join("");
}

function _teardown() {
  // Null the disconnect handler first so that cleanup events from the old
  // peer/connection don't fire the new caller's callback.
  _onDisconn = null;
  try {
    _conn?.close();
  } catch (_) {}
  try {
    _peer?.destroy();
  } catch (_) {}
  _conn = null;
  _peer = null;
}

// ─── Host ─────────────────────────────────────────────────────────────────────

/**
 * Start hosting a game.
 * @param {(code: string) => void}   onCode       4-letter room code, ready to share.
 * @param {() => void}               onConnect    Guest connected successfully.
 * @param {(msg: object) => void}    onMessage    Message received from guest.
 * @param {(reason: string) => void} onDisconnect Connection dropped or errored.
 */
export function initHost(onCode, onConnect, onMessage, onDisconnect) {
  _isHost = true;
  _onMessage = onMessage;

  _teardown();
  _onDisconn = onDisconnect;

  _tryHostWithCode(genCode(), onCode, onConnect);
}

function _tryHostWithCode(code, onCode, onConnect) {
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
      // Room code already taken — silently try a new one.
      _tryHostWithCode(genCode(), onCode, onConnect);
    } else {
      console.error("[peer] host error", err.type, err);
      _onDisconn?.(err.message ?? err.type ?? "Unknown error");
    }
  });

  _peer.on("disconnected", () => {
    // PeerJS server dropped us — attempt one reconnect.
    if (_peer && !_peer.destroyed) {
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
 * @param {() => void}               onConnect    Connected to host successfully.
 * @param {(msg: object) => void}    onMessage    Message received from host.
 * @param {(reason: string) => void} onDisconnect Connection dropped or errored.
 */
export function initGuest(code, onConnect, onMessage, onDisconnect) {
  _isHost = false;
  _onMessage = onMessage;

  _teardown();
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
 * Send a JSON-serialisable message to the peer. No-op if not connected.
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

/** Close connection and destroy the local peer. */
export function disconnect() {
  _teardown();
}
