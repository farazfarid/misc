// Group sync for Movie Park Waits: votes and live locations shared between phones.
// Transport is the public ntfy.sh pub/sub server (no account, CORS enabled). Every message is
// end-to-end encrypted with AES-GCM using a key derived from the group code, and the topic name
// is a hash of the code, so ntfy.sh only ever sees an opaque topic and ciphertext.
// ntfy.sh caches messages for about 12 hours, which is how late joiners catch up.

const NTFY = 'https://ntfy.sh';
const enc = new TextEncoder();
const dec = new TextDecoder();
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const MAX_VOTES = 3;
const MEMBER_TIMEOUT_MS = 30 * 60 * 1000;

export function newGroupCode(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export const normalizeCode = (code) => String(code || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveGroup(code) {
  const topic = 'mpw_' + hex(await crypto.subtle.digest('SHA-256', enc.encode(`mpw-topic:${code}`))).slice(0, 32);
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('mpw-v1'), iterations: 150000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  return { topic, key };
}

async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64(out);
}

async function open(key, text) {
  const raw = unb64(text);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
  return JSON.parse(dec.decode(plain));
}

const isStr = (v, max = 64) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export class GroupSync {
  constructor({ code, me, onChange, onError }) {
    this.code = normalizeCode(code);
    this.me = me; // { id, name }
    this.onChange = onChange;
    this.onError = onError;
    this.members = new Map(); // id -> { id, name, lastSeen, loc }
    this.votes = new Map(); // id -> { name, rides, ts, round }
    this.round = 'r0';
    this.roundTs = 0;
    this.seen = new Set();
    this.lastId = null;
    this.es = null;
    this.closed = false;
    this.connected = false;
  }

  async start() {
    const { topic, key } = await deriveGroup(this.code);
    this.topic = topic;
    this.key = key;
    this.connect('12h');
    this.heartbeat = setInterval(() => this.send({ t: 'hello' }), 10 * 60 * 1000);
    await this.send({ t: 'hello' });
  }

  connect(since) {
    if (this.closed) return;
    this.es = new EventSource(`${NTFY}/${this.topic}/sse?since=${encodeURIComponent(since)}`);
    this.es.onopen = () => { this.connected = true; this.onChange?.(); };
    this.es.onmessage = (e) => this.receive(e.data);
    this.es.onerror = () => {
      // Reconnect ourselves so we resume after the last message instead of replaying 12 hours.
      this.connected = false;
      this.es?.close();
      this.onChange?.();
      if (!this.closed) setTimeout(() => this.connect(this.lastId || '12h'), 5000);
    };
  }

  stop() {
    this.closed = true;
    clearInterval(this.heartbeat);
    this.es?.close();
  }

  async receive(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.event !== 'message' || !msg.message || this.seen.has(msg.id)) return;
    this.seen.add(msg.id);
    this.lastId = msg.id;
    let body;
    try { body = await open(this.key, msg.message); } catch { return; } // not ours, or tampered
    this.apply(body, (msg.time || 0) * 1000);
    this.onChange?.();
  }

  apply(m, serverTs) {
    if (!m || !isStr(m.id) || !isStr(m.name, 40)) return;
    const ts = isNum(m.ts) ? Math.min(m.ts, serverTs || m.ts) : serverTs;
    const member = this.members.get(m.id) || { id: m.id, name: m.name, lastSeen: 0, loc: null };
    member.name = m.name;
    member.lastSeen = Math.max(member.lastSeen, ts);
    this.members.set(m.id, member);

    if (m.t === 'loc' && isNum(m.lat) && isNum(m.lon) && Math.abs(m.lat) <= 90 && Math.abs(m.lon) <= 180) {
      if (!member.loc || ts >= member.loc.ts) member.loc = { lat: m.lat, lon: m.lon, acc: isNum(m.acc) ? m.acc : null, ts };
    } else if (m.t === 'unloc') {
      member.loc = null;
    } else if (m.t === 'reset' && isStr(m.round, 24) && ts >= this.roundTs) {
      this.round = m.round;
      this.roundTs = ts;
      for (const [id, v] of this.votes) if (v.round !== m.round) this.votes.delete(id);
    } else if (m.t === 'vote' && isStr(m.round, 24) && Array.isArray(m.rides)) {
      const rides = m.rides.filter((r) => isStr(r, 12) && /^\d+$/.test(r)).slice(0, MAX_VOTES);
      const prev = this.votes.get(m.id);
      if (!prev || ts >= prev.ts) this.votes.set(m.id, { name: m.name, rides, ts, round: m.round });
    } else if (m.t === 'leave') {
      this.members.delete(m.id);
      this.votes.delete(m.id);
    }
  }

  async send(payload) {
    const body = { ...payload, id: this.me.id, name: this.me.name, ts: Date.now() };
    // Apply locally right away so the UI doesn't wait for the round trip.
    this.apply(body, Date.now());
    this.onChange?.();
    try {
      const res = await fetch(`${NTFY}/${this.topic}`, { method: 'POST', body: await seal(this.key, body) });
      if (res.status === 429) throw new Error('ntfy.sh Limit erreicht, bitte kurz warten');
      if (!res.ok) throw new Error(`ntfy.sh antwortet ${res.status}`);
    } catch (err) {
      this.onError?.(err);
    }
  }

  vote(rides) { return this.send({ t: 'vote', rides: rides.slice(0, MAX_VOTES), round: this.round }); }
  newRound() { return this.send({ t: 'reset', round: `r${Date.now().toString(36)}` }); }
  shareLocation(pos) { return this.send({ t: 'loc', lat: +pos.lat.toFixed(6), lon: +pos.lon.toFixed(6), acc: Math.round(pos.acc || 0) }); }
  stopLocation() { return this.send({ t: 'unloc' }); }
  async leave() { await this.send({ t: 'leave' }); this.stop(); }

  myVotes() {
    const v = this.votes.get(this.me.id);
    return v && v.round === this.round ? v.rides : [];
  }

  activeMembers() {
    const cutoff = Date.now() - MEMBER_TIMEOUT_MS;
    return [...this.members.values()].filter((m) => m.id === this.me.id || m.lastSeen >= cutoff);
  }

  // ride id -> [voter names], only for the current round.
  tally() {
    const out = new Map();
    for (const v of this.votes.values()) {
      if (v.round !== this.round) continue;
      for (const r of v.rides) out.set(r, [...(out.get(r) || []), v.name]);
    }
    return out;
  }
}
