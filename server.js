/**
 * 跑团服务：网页界面 + 回合流程 + 存档。
 * 支持多人分享：本机是主人存档，外部访客凭邀请码进入，各自独立存档与回合锁。
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const engine = require("./engine");
const linkfetch = require("./linkfetch");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const STATE_FILE = path.join(engine.WORK, "server.json");
const SESS_DIR = path.join(engine.WORK, "sessions");
const STATS_FILE = path.join(engine.WORK, "share-stats.json");
const SHARE_STATE_FILE = path.join(engine.WORK, "share-state.json");
const FEEDBACK_FILE = path.join(engine.WORK, "feedback.json");
const VOTES_FILE = path.join(engine.WORK, "votes.json");
const UPLOAD_DIR = path.join(engine.WORK, "uploads");
const USERS_DIR = path.join(engine.WORK, "users");
const COMMUNITY_FILE = path.join(engine.WORK, "community.json");
fs.mkdirSync(SESS_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(USERS_DIR, { recursive: true });

/* ---------- 个人资料 / 上传 / 创作社区 ---------- */

const MIME_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};
const UPLOAD_MAX = 8 * 1024 * 1024;
const AVATAR_MAX = 2 * 1024 * 1024;
const communityLast = new Map();

function userFile(sid) {
  return path.join(USERS_DIR, `${sid.replace(/[^a-z0-9]/gi, "")}.json`);
}

function loadProfileFor(sid) {
  const p = readJsonFile(userFile(sid), null);
  return {
    pid: p?.pid || "",
    name: p?.name || "",
    bio: p?.bio || "",
    avatar: p?.avatar || "",
    theme: p?.theme || "#c8a06a",
    siteTheme: ["dark", "pink", "cream"].includes(p?.siteTheme) ? p.siteTheme : "dark",
    notes: p?.notes || "",
    updatedAt: p?.updatedAt || 0,
  };
}

function saveProfileFor(sid, patch) {
  const current = loadProfileFor(sid);
  const pid = current.pid || crypto.randomBytes(4).toString("hex");
  const name = String(patch.name ?? current.name).trim().slice(0, 24);
  const bio = String(patch.bio ?? current.bio).trim().slice(0, 200);
  const theme = /^#[0-9a-f]{6}$/i.test(String(patch.theme || "")) ? String(patch.theme) : current.theme;
  const siteTheme = ["dark", "pink", "cream"].includes(patch.siteTheme) ? patch.siteTheme : current.siteTheme;
  const notes = String(patch.notes ?? current.notes).slice(0, 2000);
  let avatar = String(patch.avatar ?? current.avatar);
  if (avatar && !/^\/uploads\/[a-z0-9]+\.[a-z0-9]+$/i.test(avatar)) avatar = current.avatar;
  const next = { sid, pid, name, bio, avatar, theme, siteTheme, notes, updatedAt: Date.now() };
  writeJsonFile(userFile(sid), next);
  return next;
}

function sniffMime(buffer) {
  const b = buffer;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && b.toString("latin1", 0, 3) === "GIF") return "image/gif";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (b.length > 12 && b.toString("latin1", 4, 8) === "ftyp") return "video/mp4";
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  return "";
}

function saveUpload(base64, declaredMime, maxBytes) {
  const raw = String(base64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw new Error("没有收到文件内容");
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw new Error("文件内容为空");
  if (buffer.length > maxBytes) throw new Error(`文件太大，最多 ${Math.round(maxBytes / 1048576)}MB`);
  const sniffed = sniffMime(buffer);
  const mime = MIME_EXT[declaredMime] ? declaredMime : sniffed;
  if (!mime || !MIME_EXT[mime]) throw new Error("只支持图片（png/jpg/gif/webp）或视频（mp4/webm）");
  if (sniffed && sniffed !== mime) throw new Error("文件内容与类型不符");
  const name = crypto.randomBytes(8).toString("hex") + MIME_EXT[mime];
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return { url: `/uploads/${name}`, type: mime, size: buffer.length };
}

let community = readJsonFile(COMMUNITY_FILE, []);
if (!Array.isArray(community)) community = [];

/* ---------- 多人联机房间 ---------- */

const ROOMS_FILE = path.join(engine.WORK, "rooms.json");
let rooms = readJsonFile(ROOMS_FILE, {});
if (!rooms || typeof rooms !== "object" || Array.isArray(rooms)) rooms = {};
const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function saveRooms() {
  writeJsonFile(ROOMS_FILE, rooms);
}

function makeRoomCode() {
  for (let i = 0; i < 50; i += 1) {
    let code = "";
    for (let j = 0; j < 5; j += 1) code += ROOM_CHARS[crypto.randomInt(0, ROOM_CHARS.length)];
    if (!rooms[code]) return code;
  }
  return String(Date.now()).slice(-5);
}

function newRoomState() {
  return {
    time: { day: 1, minute: 18 * 60 },
    firedEvents: [],
    status: {},
    items: {},
    events: [],
    relations: {},
    plot: [],
    codex: [],
    growth: {},
  };
}

function publicRoom(room, sid) {
  return {
    code: room.code,
    status: room.status,
    mode: room.mode,
    difficulty: room.difficulty,
    scenario: { title: room.scenario.title, genre: room.scenario.genre, blurb: room.scenario.blurb },
    players: room.players.map((p) => ({
      pid: p.pid,
      name: p.name,
      avatar: p.avatar,
      character: p.character,
      ready: Boolean(room.actions[p.sid]),
    })),
    isHost: room.hostSid === sid,
    hostPid: room.hostPid,
    turn: room.turn,
    log: room.log.slice(-80),
    state: {
      ...room.state,
      clock: engine.clockText(room.state.time),
    },
    myActionSubmitted: Boolean(room.actions[sid]),
    busy: Boolean(room.busy),
  };
}

function applyRoomState(room, st) {
  const state = room.state;
  if (Number.isFinite(Number(st.advance_minutes))) {
    const mock = { time: state.time, firedEvents: state.firedEvents || [], eventLog: state.events };
    const fired = engine.advanceTime(mock, room.scenario, Number(st.advance_minutes));
    state.time = mock.time;
    state.firedEvents = mock.firedEvents;
    for (const ev of fired) {
      state.events.push({ at: engine.clockText(state.time), title: ev.title, note: ev.note || "" });
    }
  }
  const players = st.players && typeof st.players === "object" ? st.players : {};
  for (const [pid, upd] of Object.entries(players)) {
    if (!upd || typeof upd !== "object") continue;
    const ps = state.status[pid] || (state.status[pid] = { hp: 10, hpMax: 10, san: 10, sanMax: 10, money: 20 });
    for (const key of ["hp", "san", "money"]) {
      if (Number.isFinite(Number(upd[key]))) ps[key] = Number(ps[key] || 0) + Number(upd[key]);
    }
    ps.hp = Math.max(0, ps.hp);
    ps.san = Math.max(0, ps.san);
    const items = state.items[pid] || (state.items[pid] = []);
    for (const it of upd.items_add || []) if (it && !items.includes(it)) items.push(String(it));
    for (const it of upd.items_remove || []) {
      const i = items.indexOf(String(it));
      if (i >= 0) items.splice(i, 1);
    }
    const g = state.growth[pid] || (state.growth[pid] = { xp: 0, level: 1 });
    if (Number.isFinite(Number(upd.xp))) {
      g.xp += Number(upd.xp);
      g.level = 1 + Math.floor(g.xp / 10);
    }
    if (upd.attrs_add && typeof upd.attrs_add === "object") {
      g.attrs = g.attrs || {};
      for (const [k, v] of Object.entries(upd.attrs_add)) {
        if (Number.isFinite(Number(v))) g.attrs[k] = (g.attrs[k] || 0) + Number(v);
      }
    }
  }
  for (const ev of st.events || []) {
    if (ev) state.events.push({ at: engine.clockText(state.time), title: String(ev).slice(0, 120), note: "" });
  }
  for (const c of st.codex || []) {
    if (c && !state.codex.includes(String(c))) state.codex.push(String(c));
  }
  if (st.relations && typeof st.relations === "object") {
    for (const [k, v] of Object.entries(st.relations)) {
      state.relations[k] = typeof v === "string" ? v : v?.attitude || String(v);
    }
  }
  for (const p of st.plot || []) {
    if (p && !state.plot.includes(String(p))) state.plot.push(String(p));
  }
  while (state.events.length > 60) state.events.shift();
  while (state.plot.length > 40) state.plot.shift();
  while (state.codex.length > 80) state.codex.shift();
}

function roomPrompt(room) {
  const sc = room.scenario;
  const modeLine =
    room.mode === "free"
      ? "【模式】自由叙事：不掷骰、不做数值判定，玩家写什么就顺着推演，保证世界一致与因果即可。"
      : "【模式】跑团：保留难度与代价，按玩家人数缩放挑战强度。";
  const count = room.players.length;
  const diffLine = {
    easy: "轻松：多给线索，少给致命后果。",
    normal: "标准：有代价，但不轻易团灭。",
    hard: "硬核：后果严重，失败会留下长期伤痕。",
  }[room.difficulty] || "";
  const sheets = room.players
    .map((p) => {
      const st = room.state.status[p.pid] || {};
      const items = (room.state.items[p.pid] || []).join("、") || "空";
      const g = room.state.growth[p.pid] || {};
      const a = p.character.attrs || {};
      const attrText = `力${a.str ?? 5} 敏${a.dex ?? 5} 体${a.con ?? 5} 智${a.int ?? 5} 感${a.per ?? 5} 魅${a.cha ?? 5}`;
      return `- ${p.character.name}（玩家 ${p.name}）：${p.character.role || "旅人"}${p.character.bio ? "｜" + p.character.bio : ""}｜${attrText}｜HP ${st.hp ?? "?"} / SAN ${st.san ?? "?"}｜等级 ${g.level || 1}｜物品：${items}`;
    })
    .join("\n");
  const actions = room.players
    .map((p) => `${p.character.name}：${room.actions[p.sid] || "（本轮没有行动）"}`)
    .join("\n");
  const recent = room.log
    .slice(-8)
    .map((e) => (e.type === "gm" ? `GM：${e.text}` : `${e.who || "玩家"}：${e.text}`))
    .join("\n");
  return [
    "你是多人联机跑团的主持人。",
    `【剧本】${sc.title}（${sc.genre}）`,
    `背景：${sc.background}`,
    `玩家处境：${sc.hook || ""}`,
    `真相（不可直接说破）：${sc.truth || ""}`,
    `人物：${(sc.npcs || []).map((n) => n.name + "：" + n.desc).join("；")}`,
    `时间表：${(sc.schedule || []).map((e) => `${e.day}天${Math.floor(e.minute / 60)}:${String(e.minute % 60).padStart(2, "0")} ${e.title}`).join("；")}`,
    modeLine,
    `玩家人数：${count} 人。${diffLine} 人数越多，敌人与障碍应越强，但奖励和线索也要相应增加。`,
    `【当前时间】${engine.clockText(room.state.time)}`,
    `【玩家角色】\n${sheets}`,
    `【已有事件】${room.state.events.map((e) => e.title).join("、") || "无"}`,
    `【线索/图鉴】${room.state.codex.join("、") || "无"}`,
    `【情节线】${room.state.plot.join("、") || "无"}`,
    `【最近发生】\n${recent || "（刚开始）"}`,
    `【本轮玩家行动】\n${actions}`,
    "请写一段照顾到所有玩家行动的叙述（每人都有戏份），结尾输出状态块：",
    '<state>{"advance_minutes":15,"players":{"玩家pid":{"hp":0,"san":-1,"money":0,"items_add":[],"items_remove":[],"xp":2,"attrs_add":{}}},"events":["..."],"relations":{"NPC":"态度"},"plot":["..."],"codex":["..."]}</state>',
    "不要输出任何其他标签。",
  ].join("\n");
}

function sanitizeRoomCharacter(input, fallbackName) {
  const c = input && typeof input === "object" ? input : {};
  const attrs = {};
  for (const k of ["str", "dex", "con", "int", "per", "cha"]) {
    const v = Number(c.attrs && c.attrs[k]);
    attrs[k] = Number.isFinite(v) ? Math.max(1, Math.min(10, Math.round(v))) : 5;
  }
  return {
    name: String(c.name || fallbackName || "旅人").slice(0, 24),
    role: String(c.role || "旅人").slice(0, 40),
    bio: String(c.bio || "").slice(0, 200),
    attrs,
  };
}

function initRoomStatus(character) {
  const a = character.attrs || {};
  const hpMax = 18 + (Number(a.con) || 5) * 2;
  const sanMax = 18 + (Number(a.int) || 5) + (Number(a.per) || 5);
  return { hp: hpMax, hpMax, san: sanMax, sanMax, money: 20 };
}

function communityView(post, sid) {
  return {
    id: post.id,
    type: post.type || "post",
    author: post.author,
    pid: post.pid || "",
    avatar: post.avatar || "",
    title: post.title,
    text: post.text,
    genre: post.scenario?.genre || "",
    blurb: post.scenario?.blurb || "",
    media: post.media || null,
    at: post.at,
    likes: (post.likes || []).length,
    liked: (post.likes || []).includes(sid),
  };
}

function ownScenarioDir(entry) {
  return entry.owner ? engine.USER_SCENARIO_DIR : guestDir(entry);
}

function listOwnScenarios(entry) {
  const dir = ownScenarioDir(entry);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        return data.custom ? data : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function ownScenario(entry, id) {
  return listOwnScenarios(entry).find((s) => s.id === id) || null;
}

function allProfiles() {
  if (!fs.existsSync(USERS_DIR)) return [];
  return fs
    .readdirSync(USERS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(USERS_DIR, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((p) => p && p.pid && p.sid);
}

/* ---------- 在线人数 / 好评差评 / 留言板 ---------- */

const PRESENCE_TTL = 8000;
const presence = new Map();
const lastPostAt = new Map();

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {}
}

let votes = readJsonFile(VOTES_FILE, { up: 0, down: 0, voters: {} });
if (!votes.voters || typeof votes.voters !== "object") votes.voters = {};
let feedback = readJsonFile(FEEDBACK_FILE, []);
if (!Array.isArray(feedback)) feedback = [];

function onlineCount() {
  const now = Date.now();
  let n = 0;
  for (const [sid, seen] of presence) {
    if (now - seen <= PRESENCE_TTL) n += 1;
    else presence.delete(sid);
  }
  return n;
}

function voteSnapshot(sid) {
  return { up: votes.up, down: votes.down, mine: votes.voters[sid] || null };
}

const shareKey = String(engine.config.shareKey || "").trim();
const numOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const guestTurnLimit = numOr(engine.config.guestTurnLimit, 60);
const guestDailyCalls = numOr(engine.config.guestDailyCalls, 150);
const maxConcurrentModels = numOr(engine.config.maxConcurrentModels, 2);

/** 管理密码：优先 ADMIN_PASSWORD，否则从 DeepSeek 密钥派生，避免公开仓库泄露。 */
const ADMIN_PASSWORD = (() => {
  const explicit = String(process.env.ADMIN_PASSWORD || engine.config.adminPassword || "").trim();
  if (explicit) return explicit;
  const apiKey = String(process.env.SECRET_KEY || process.env.DEEPSEEK_API_KEY || engine.config.apiKey || "");
  if (!apiKey) return "";
  return crypto.createHash("sha256").update(apiKey + "|paotuan-admin|v1").digest("hex").slice(0, 24);
})();

const SESSION_SECRET = crypto.createHash("sha256").update("paotuan-session|" + ADMIN_PASSWORD).digest();
const ADMIN_TTL_MS = 30 * 24 * 3600 * 1000;

function signToken(exp) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(String(exp)).digest("hex");
}

function makeAdminToken() {
  const exp = Date.now() + ADMIN_TTL_MS;
  return exp + "." + signToken(exp);
}

function validAdminToken(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 2) return false;
  const exp = Number(parts[0]);
  if (!exp || Date.now() > exp) return false;
  const expect = signToken(exp);
  if (parts[1].length !== expect.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expect));
  } catch {
    return false;
  }
}

function isAdminReq(req) {
  return validAdminToken(parseCookies(req.headers.cookie).pt_admin);
}

function isOwnerReq(req) {
  return validAdminToken(parseCookies(req.headers.cookie).pt_owner);
}

/* 登录失败限流：同一 IP 10 分钟内最多 8 次 */
const loginFails = new Map();

function loginBlocked(ip) {
  const rec = loginFails.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.reset) {
    loginFails.delete(ip);
    return false;
  }
  return rec.count >= 8;
}

function recordLoginFail(ip) {
  const rec = loginFails.get(ip);
  if (!rec || Date.now() > rec.reset) {
    loginFails.set(ip, { count: 1, reset: Date.now() + 10 * 60 * 1000 });
    return;
  }
  rec.count += 1;
}

function secureCookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function loadShareState() {
  try {
    const s = JSON.parse(fs.readFileSync(SHARE_STATE_FILE, "utf8"));
    return { open: s.open !== false, openUntil: Number(s.openUntil) || 0, updatedAt: Number(s.updatedAt) || 0 };
  } catch {
    return { open: true, openUntil: 0, updatedAt: 0 };
  }
}

let shareState = loadShareState();

function saveShareState(next) {
  shareState = next;
  try {
    fs.writeFileSync(SHARE_STATE_FILE, JSON.stringify(next, null, 2));
  } catch {}
}

function siteOpen() {
  if (!shareState.open) return false;
  if (!shareState.openUntil) return true;
  return Date.now() < shareState.openUntil;
}

const store = new Map(); // sid -> { sid, owner, session, busy, lastSeen }
let activeModels = 0;
const waiters = []; // 超并发时不拒绝人，按先来后到排队

function acquireSlot() {
  if (activeModels < maxConcurrentModels) {
    activeModels += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) {
    next();
    return;
  }
  activeModels = Math.max(0, activeModels - 1);
}

/* ---------- 工具 ---------- */

function send(res, code, body, type = "application/json; charset=utf-8") {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const headers = { "content-type": type, "content-length": Buffer.byteLength(payload) };
  if (res._cookies?.length) headers["set-cookie"] = res._cookies;
  res.writeHead(code, headers);
  res.end(payload);
}

function setCookie(res, value) {
  if (!res._cookies) res._cookies = [];
  res._cookies.push(value);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function readRaw(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
  });
}

function parseCookies(header) {
  const out = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i < 0) return;
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
  return out;
}

/** 直接访问 127.0.0.1 / localhost 的是本机主人；经隧道进来的 Host 是公网域名。 */
function isLocal(req) {
  const host = String(req.headers.host || "");
  const localHost = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host);
  return localHost && !req.headers["cf-connecting-ip"] && !req.headers["cf-ray"];
}

function sessFile(sid) {
  return sid === "owner" ? path.join(engine.WORK, "session.json") : path.join(SESS_DIR, `${sid}.json`);
}

/** 访客的私有剧本目录：他们只能看到、修改、删除自己目录里的剧本。 */
function guestDir(entry) {
  return entry.owner ? undefined : path.join(engine.WORK, "guest-scenarios", entry.sid);
}

function ensureGuestDir(entry) {
  const dir = guestDir(entry);
  if (dir) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEntry(sid, owner) {
  return {
    sid,
    owner,
    session: engine.loadSession(sessFile(sid)),
    busy: false,
    lastSeen: Date.now(),
  };
}

function getEntry(sid, owner) {
  if (!store.has(sid)) store.set(sid, makeEntry(sid, owner));
  const entry = store.get(sid);
  entry.lastSeen = Date.now();
  return entry;
}

function saveEntry(entry) {
  if (entry.session) engine.saveSession(entry.session, sessFile(entry.sid));
}

function clearEntry(entry) {
  entry.session = null;
  const file = sessFile(entry.sid);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

function denyPage() {
  return `<!doctype html><meta charset="utf-8"><title>需要邀请链接</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d0f15;color:#e7e8ee;font:16px/1.7 'Microsoft YaHei',sans-serif">
<div style="text-align:center;max-width:520px;padding:24px">
<div style="font-size:20px;letter-spacing:2px;margin-bottom:12px">这个入口需要邀请链接</div>
<div style="color:#8b90a0">请向分享者索取带邀请码的完整链接（形如 <code>?k=xxxxxx</code>）。</div>
</div></body>`;
}

function closedPage() {
  return `<!doctype html><meta charset="utf-8"><title>暂停营业</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d0f15;color:#e7e8ee;font:16px/1.8 'Microsoft YaHei',sans-serif">
<div style="text-align:center;max-width:520px;padding:24px">
<div style="font-size:22px;letter-spacing:3px;color:#c8a06a;margin-bottom:14px">今日暂停营业</div>
<div style="color:#8b90a0">房主暂时关闭了入口，晚点再来。</div>
<div style="color:#4a5062;font-size:13px;margin-top:18px">（这不是故障，入口随时会重新开放）</div>
</div></body>`;
}

function adminDeniedPage() {
  return `<!doctype html><meta charset="utf-8"><title>需要管理密钥</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d0f15;color:#e7e8ee;font:16px/1.8 'Microsoft YaHei',sans-serif">
<div style="text-align:center;max-width:520px;padding:24px">
<div style="font-size:20px;letter-spacing:2px;margin-bottom:12px">这个页面需要管理密钥</div>
<div style="color:#8b90a0">请使用带 ?key= 的完整管理链接。</div>
</div></body>`;
}

function loginPage(error, blocked) {
  const msg = blocked
    ? "尝试次数过多，请 10 分钟后再试。"
    : error
      ? "密码不正确。"
      : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>房主登录</title>
<style>
body{margin:0;min-height:100vh;background:#0d0f15;color:#e7e8ee;font:15px/1.7 'Microsoft YaHei',sans-serif;display:grid;place-items:center;padding:24px}
form{width:min(380px,100%);background:#151823;border:1px solid #262b3a;border-radius:18px;padding:28px}
h1{font-size:19px;margin:0 0 4px;letter-spacing:2px}
.sub{color:#8b90a0;font-size:13px;margin-bottom:20px}
input{width:100%;box-sizing:border-box;padding:11px 13px;border-radius:10px;border:1px solid #2d3344;background:#10131b;color:#e7e8ee;font:inherit;outline:none}
input:focus{border-color:#c8a06a}
button{margin-top:16px;width:100%;border:0;border-radius:10px;padding:11px;background:#c8a06a;color:#1a1408;font:inherit;font-weight:600;cursor:pointer}
.err{margin-top:12px;color:#f0a3b4;font-size:13px;min-height:18px}
.hint{margin-top:16px;color:#6f7486;font-size:12px;line-height:1.7}
</style></head><body>
<form method="post" action="/admin/login">
  <h1>房主登录</h1>
  <div class="sub">这里是私密后台，只有房主可以进入。</div>
  <input type="password" name="password" placeholder="管理密码" autocomplete="current-password" autofocus>
  <button type="submit">进入</button>
  <div class="err">${msg}</div>
  <div class="hint">登录后 30 天内免登录；可在后台退出或进入房主模式管理剧本。</div>
</form></body></html>`;
}

function adminState() {
  const now = Date.now();
  return {
    open: siteOpen(),
    manualOpen: shareState.open,
    openUntil: shareState.openUntil || 0,
    minutesLeft: shareState.openUntil ? Math.max(0, Math.round((shareState.openUntil - now) / 60000)) : 0,
    updatedAt: shareState.updatedAt || 0,
    guestTurnLimit,
    guestDailyCalls,
    callsToday: readStats().calls,
  };
}

function dataStats() {
  const count = (dir, ext) => {
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).length;
    } catch {
      return 0;
    }
  };
  return {
    feedback: feedback.length,
    up: votes.up || 0,
    down: votes.down || 0,
    users: count(USERS_DIR, ".json"),
    community: community.length,
    rooms: Object.keys(rooms).length,
    sessions: count(SESS_DIR, ".json"),
    uploads: count(UPLOAD_DIR, ""),
    dataDir: engine.WORK,
    persistent: process.env.PERSISTENT === "1" || !process.env.RENDER,
  };
}

function buildBackup() {
  const readDir = (dir) => {
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try {
            return { name: f, data: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  };
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    feedback,
    votes,
    community,
    rooms,
    users: readDir(USERS_DIR),
    sessions: readDir(SESS_DIR),
  };
}

function adminPage() {
  const html = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>跑团入口开关</title><style>",
    "body{margin:0;min-height:100vh;background:#0d0f15;color:#e7e8ee;font:15px/1.7 'Microsoft YaHei',sans-serif;display:grid;place-items:center;padding:24px}",
    ".card{width:min(560px,100%);background:#151823;border:1px solid #262b3a;border-radius:18px;padding:26px}",
    "h1{font-size:20px;margin:0 0 6px;letter-spacing:2px}",
    ".sub{color:#8b90a0;font-size:13px;margin-bottom:20px}",
    ".status{padding:14px 16px;border-radius:12px;margin-bottom:18px;font-size:16px;letter-spacing:1px}",
    ".on{background:#14251c;border:1px solid #2f6a4a;color:#8fd8ac}",
    ".off{background:#2a1720;border:1px solid #6a2f3f;color:#f0a3b4}",
    ".meta{color:#8b90a0;font-size:12.5px;margin-top:6px;letter-spacing:0}",
    ".row{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}",
    "button{border:0;border-radius:10px;padding:10px 18px;font:inherit;cursor:pointer;background:#262b3a;color:#e7e8ee}",
    "button.primary{background:#c8a06a;color:#1a1408;font-weight:600}",
    "button.danger{background:#5a2330;color:#ffd7de}",
    ".note{color:#6f7486;font-size:12.5px;margin-top:18px;line-height:1.7}",
    "</style></head><body><div class=card>",
    "<h1>跑团入口开关</h1>",
    '<div class="sub">关闭后所有访客都会看到“今日暂停营业”，模型不会被调用。</div>',
    '<div id="status" class="status off">读取中…</div>',
    '<div class="row">',
    '<button id="close" class="danger">立即关闭</button>',
    '<button id="open1">开放 1 小时</button>',
    '<button id="open2">开放 2 小时</button>',
    '<button id="open0" class="primary">持续开放</button>',
    "</div>",
    '<div class="note">每日调用上限：<b id="cap"></b> 次（今天已用 <b id="used"></b> 次）。<br>',
    "达到上限后会自动停止接待，次日恢复。上限在主机的 GUEST_DAILY_CALLS 环境变量里改。</div>",
    '<div class="note" style="margin-top:16px;border-top:1px solid #262b3a;padding-top:14px">',
    "<b>数据总览</b><br>留言 <b id=\"d-fb\">-</b> · 好评 <b id=\"d-up\">-</b> · 差评 <b id=\"d-down\">-</b> · 用户 <b id=\"d-users\">-</b><br>",
    "作品 <b id=\"d-cm\">-</b> · 房间 <b id=\"d-rooms\">-</b> · 存档 <b id=\"d-sessions\">-</b> · 上传 <b id=\"d-uploads\">-</b><br>",
    '<span id="d-persist"></span>',
    '<div class="row" style="margin-top:10px">',
    '<button id="btn-backup">下载全部数据备份</button>',
    '<label style="display:inline-block;border:1px solid #262b3a;border-radius:9px;padding:6px 12px;color:#8b90a0;font-size:12.5px;cursor:pointer">从备份恢复<input id="restore-file" type="file" accept="application/json,.json" hidden></label>',
    '<span id="d-status" style="color:#8b90a0;font-size:12px"></span>',
    "</div></div>",
    '<div class="row" style="margin-top:18px">',
    '<form method="post" action="/admin/owner"><button class="primary" type="submit">进入房主模式</button></form>',
    '<form method="post" action="/admin/owner/off"><button type="submit">退出房主模式</button></form>',
    '<form method="post" action="/admin/logout"><button type="submit">退出登录</button></form>',
    "</div>",
    "</div><script>",
    'const statusEl = document.getElementById("status");',
    'function fmt(m){ return m > 0 ? ("剩余约 " + m + " 分钟") : "未设自动关闭"; }',
    "async function refresh(){",
    '  const r = await fetch("/api/admin/state");',
    "  const s = await r.json();",
    '  statusEl.className = "status " + (s.open ? "on" : "off");',
    '  statusEl.innerHTML = (s.open ? "● 正在营业" : "● 已关闭") +',
    '    `<div class="meta">` + (s.open ? fmt(s.minutesLeft) : "访客将看到暂停营业页") + "</div>";',
    '  document.getElementById("cap").textContent = s.guestDailyCalls > 0 ? s.guestDailyCalls : "不限";',
    '  document.getElementById("used").textContent = s.callsToday;',
    "}",
    "async function setState(open, minutes){",
    '  await fetch("/api/admin/state", {',
    '    method: "POST", headers: {"content-type": "application/json"},',
    "    body: JSON.stringify({open, minutes})",
    "  });",
    "  refresh();",
    "}",
    "async function refreshStats(){",
    '  const s = await (await fetch("/api/admin/stats")).json();',
    '  document.getElementById("d-fb").textContent = s.feedback;',
    '  document.getElementById("d-up").textContent = s.up;',
    '  document.getElementById("d-down").textContent = s.down;',
    '  document.getElementById("d-users").textContent = s.users;',
    '  document.getElementById("d-cm").textContent = s.community;',
    '  document.getElementById("d-rooms").textContent = s.rooms;',
    '  document.getElementById("d-sessions").textContent = s.sessions;',
    '  document.getElementById("d-uploads").textContent = s.uploads;',
    '  const p = document.getElementById("d-persist");',
    '  p.style.color = s.persistent ? "#8fd8ac" : "#f0a3b4";',
    '  p.textContent = s.persistent ? "数据目录：" + s.dataDir + "（已使用持久目录）" : "⚠ 当前没有持久盘：重启/部署会清空留言、票数、用户与作品。请定期备份，或在 Render 挂载 /data 磁盘。";',
    "}",
    'document.getElementById("btn-backup").onclick = async () => {',
    '  const b = await (await fetch("/api/admin/backup")).json();',
    '  const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });',
    '  const url = URL.createObjectURL(blob);',
    '  const a = document.createElement("a");',
    '  a.href = url; a.download = "paotuan-backup-" + new Date().toISOString().slice(0,10) + ".json";',
    "  document.body.appendChild(a); a.click(); a.remove();",
    "  setTimeout(() => URL.revokeObjectURL(url), 3000);",
    '  document.getElementById("d-status").textContent = "备份已下载";',
    "};",
    'document.getElementById("restore-file").onchange = async (e) => {',
    "  const f = e.target.files[0]; e.target.value = ''; if (!f) return;",
    '  if (!confirm("恢复会覆盖当前数据，确定吗？")) return;',
    "  const backup = JSON.parse(await f.text());",
    '  const r = await fetch("/api/admin/restore", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ backup }) });',
    '  const d = await r.json();',
    '  document.getElementById("d-status").textContent = r.ok ? "恢复完成" : (d.error || "恢复失败");',
    "  refreshStats();",
    "};",
    "refreshStats();",
    'document.getElementById("close").onclick = () => setState(false, 0);',
    'document.getElementById("open1").onclick = () => setState(true, 60);',
    'document.getElementById("open2").onclick = () => setState(true, 120);',
    'document.getElementById("open0").onclick = () => setState(true, 0);',
    "refresh();",
    "</script></body></html>",
  ];
  return html.join("");
}

function ctxFor(req, res) {
  if (isLocal(req)) {
    return { entry: getEntry("owner", true), local: true };
  }
  const url = new URL(req.url, "http://x");
  const cookies = parseCookies(req.headers.cookie);
  if (isOwnerReq(req)) {
    return { entry: getEntry("owner", true), local: false, ownerCookie: true };
  }
  const adminPath = url.pathname === "/admin" || url.pathname.startsWith("/admin/") || url.pathname.startsWith("/api/admin/");
  if (shareKey && !adminPath) {
    const provided = url.searchParams.get("k") || cookies.rk || "";
    if (provided !== shareKey) return { denied: true };
    if (cookies.rk !== shareKey) setCookie(res, `rk=${encodeURIComponent(shareKey)}; Path=/; Max-Age=2592000; SameSite=Lax`);
  }
  let sid = cookies.tg_sid;
  if (!/^[a-f0-9]{16,40}$/.test(String(sid || ""))) {
    sid = crypto.randomBytes(12).toString("hex");
    setCookie(res, `tg_sid=${sid}; Path=/; Max-Age=2592000; SameSite=Lax`);
  }
  return { entry: getEntry(sid, false), local: false, freshCookie: true };
}

/* ---------- 访客配额 ---------- */

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readStats() {
  try {
    const data = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    if (data.date === todayKey()) return data;
  } catch {}
  return { date: todayKey(), calls: 0 };
}

function addGuestCalls(n) {
  const stats = readStats();
  stats.calls += n;
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch {}
  return stats;
}

function guestQuotaLeft() {
  if (guestDailyCalls <= 0) return Infinity;
  return Math.max(0, guestDailyCalls - readStats().calls);
}

/* ---------- 会话展示 ---------- */

function scenarioMeta(entry, id) {
  return engine.listScenarios(guestDir(entry)).find((s) => s.id === id) || null;
}

function publicSession(entry) {
  const session = entry.session;
  if (!session) return null;
  return {
    ...session,
    scenario: scenarioMeta(entry, session.scenarioId),
    upcoming: engine.upcomingEvents(session, engine.loadScenario(session.scenarioId, guestDir(entry)) || {}).slice(0, 6),
    clock: engine.clockText(session.time),
    limits: {
      logKeep: 800,
      logTrimAt: 1200,
      maxChecksPerTurn: 2,
      maxActionChars: 500,
      modelTimeoutSec: 150,
      avgInputK: Math.round(((session.usage?.input || 0) / Math.max(1, session.usage?.calls || 1)) / 100),
    },
    settings: engine.getSettings(),
    schedule: (engine.loadScenario(session.scenarioId, guestDir(entry))?.schedule || []).map((ev, index) => {
      const key = `${ev.day}-${ev.minute}-${index}`;
      return { ...ev, key, fired: session.firedEvents.includes(key) };
    }),
  };
}

/* ---------- 请求处理 ---------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const p = url.pathname;

  if (p !== "/app.js" && p !== "/style.css") {
    res.setHeader("cache-control", "no-store");
  }

  const ctx = ctxFor(req, res);
  if (ctx.denied) return send(res, 403, denyPage(), "text/html; charset=utf-8");
  const entry = ctx.entry;

  const adminOk = entry.owner || isAdminReq(req);

  res.setHeader("cache-control", "no-store");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");

  if (p === "/admin/login" && req.method === "POST") {
    const ip = req.socket.remoteAddress || "unknown";
    if (loginBlocked(ip)) return send(res, 429, loginPage("", true), "text/html; charset=utf-8");
    const raw = await readRaw(req);
    const password = new URLSearchParams(raw).get("password") || "";
    const ok =
      ADMIN_PASSWORD.length > 0 &&
      password.length === ADMIN_PASSWORD.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD));
    if (!ok) {
      recordLoginFail(ip);
      res.writeHead(302, { location: "/admin?e=1" });
      res.end();
      return;
    }
    res.setHeader("set-cookie", secureCookie("pt_admin", makeAdminToken(), 30 * 24 * 3600));
    res.writeHead(302, { location: "/admin" });
    res.end();
    return;
  }

  if (p === "/admin/logout" && req.method === "POST") {
    res.setHeader("set-cookie", [secureCookie("pt_admin", "", 0), secureCookie("pt_owner", "", 0)]);
    res.writeHead(302, { location: "/admin" });
    res.end();
    return;
  }

  if (p === "/admin/owner" && req.method === "POST") {
    if (!adminOk) return send(res, 403, adminDeniedPage(), "text/html; charset=utf-8");
    res.setHeader("set-cookie", secureCookie("pt_owner", makeAdminToken(), 7 * 24 * 3600));
    res.writeHead(302, { location: "/" });
    res.end();
    return;
  }

  if (p === "/admin/owner/off" && req.method === "POST") {
    res.setHeader("set-cookie", secureCookie("pt_owner", "", 0));
    res.writeHead(302, { location: "/admin" });
    res.end();
    return;
  }

  if (p === "/admin") {
    if (!adminOk) {
      const err = url.searchParams.get("e");
      return send(res, 200, loginPage(err ? "1" : "", false), "text/html; charset=utf-8");
    }
    return send(res, 200, adminPage(), "text/html; charset=utf-8");
  }
  if (p === "/api/admin/state") {
    if (!adminOk) return send(res, 403, { error: "没有管理权限" });
    if (req.method === "GET") return send(res, 200, adminState());
    const body = await readBody(req);
    const open = Boolean(body.open);
    const minutes = Math.max(0, Math.min(24 * 60, Number(body.minutes) || 0));
    saveShareState({
      open,
      openUntil: open && minutes > 0 ? Date.now() + minutes * 60000 : 0,
      updatedAt: Date.now(),
    });
    return send(res, 200, adminState());
  }

  if (p === "/api/admin/stats") {
    if (!adminOk) return send(res, 403, { error: "没有管理权限" });
    return send(res, 200, dataStats());
  }

  if (p === "/api/admin/backup") {
    if (!adminOk) return send(res, 403, { error: "没有管理权限" });
    return send(res, 200, buildBackup());
  }

  if (req.method === "POST" && p === "/api/admin/restore") {
    if (!adminOk) return send(res, 403, { error: "没有管理权限" });
    const body = await readBody(req);
    const b = body.backup || body;
    if (!b || typeof b !== "object") return send(res, 400, { error: "备份文件格式不对" });
    if (Array.isArray(b.feedback)) {
      feedback = b.feedback.slice(0, 500);
      writeJsonFile(FEEDBACK_FILE, feedback);
    }
    if (b.votes && typeof b.votes === "object") {
      votes = {
        up: Number(b.votes.up) || 0,
        down: Number(b.votes.down) || 0,
        voters: b.votes.voters && typeof b.votes.voters === "object" ? b.votes.voters : {},
      };
      writeJsonFile(VOTES_FILE, votes);
    }
    if (Array.isArray(b.community)) {
      community = b.community.slice(0, 200);
      writeJsonFile(COMMUNITY_FILE, community);
    }
    if (b.rooms && typeof b.rooms === "object" && !Array.isArray(b.rooms)) {
      rooms = b.rooms;
      saveRooms();
    }
    for (const u of Array.isArray(b.users) ? b.users : []) {
      if (u && typeof u.name === "string" && /^[\w-]+\.json$/.test(u.name)) {
        writeJsonFile(path.join(USERS_DIR, u.name), u.data);
      }
    }
    for (const s of Array.isArray(b.sessions) ? b.sessions : []) {
      if (s && typeof s.name === "string" && /^[\w-]+\.json$/.test(s.name)) {
        writeJsonFile(path.join(SESS_DIR, s.name), s.data);
      }
    }
    return send(res, 200, { ok: true, stats: dataStats() });
  }

  if (!entry.owner && !siteOpen()) {
    return send(res, 503, closedPage(), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8"), "text/html; charset=utf-8");
  }
  if (req.method === "GET" && (p === "/app.js" || p === "/style.css")) {
    const type = p.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
    if (!fs.existsSync(path.join(PUBLIC, p))) return send(res, 404, "not found", "text/plain; charset=utf-8");
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, p), "utf8"), type);
  }
  if (p === "/api/ping") {
    return send(res, 200, {
      ok: true,
      model: engine.config.model,
      shared: Boolean(shareKey),
      commit: String(process.env.RENDER_GIT_COMMIT || "").slice(0, 7) || "local",
    });
  }
  if (p === "/api/meta") {
    return send(res, 200, {
      scenarios: engine.listScenarios(guestDir(entry)).map((s) => ({
        ...s,
        editable: entry.owner ? s.custom : Boolean(s.guestOwned),
      })),
      presets: engine.listPresets(),
      attrs: engine.ATTRS,
      skills: engine.SKILLS,
      difficulty: engine.DIFFICULTY,
      settings: engine.getSettings(),
      narrativeLengths: Object.keys(engine.NARRATIVE_LENGTH),
      attrPoints: engine.ATTR_POINTS,
      attrMin: engine.ATTR_MIN,
      attrMax: engine.ATTR_MAX,
      model: engine.config.model,
      isOwner: entry.owner,
      siteOpen: siteOpen(),
      guestTurnLimit: entry.owner ? null : guestTurnLimit,
      hasSave: Boolean(entry.session),
    });
  }
  if (p === "/api/settings") {
    if (req.method === "GET") return send(res, 200, engine.getSettings());
    if (!entry.owner) return send(res, 403, { error: "访客不能改全局设定。" });
    const body = await readBody(req);
    try {
      return send(res, 200, engine.saveSettings(body));
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
  }
  if (req.method === "POST" && p === "/api/links/fetch") {
    const body = await readBody(req);
    const urls = (Array.isArray(body.urls) ? body.urls : [])
      .map((u) => String(u || "").trim())
      .filter(Boolean)
      .slice(0, linkfetch.MAX_LINKS);
    if (!urls.length) return send(res, 400, { error: "没有可抓取的链接" });
    try {
      const fetched = [];
      const failed = [];
      for (const one of urls) {
        try {
          fetched.push(await linkfetch.fetchLink(one));
        } catch (err) {
          failed.push({ url: one, error: String(err.message || err) });
        }
      }
      return send(res, 200, { links: engine.sanitizeLinks(fetched), failed });
    } catch (err) {
      return send(res, 500, { error: `抓取失败：${err.message}` });
    }
  }
  if (p === "/api/scenario") {
    if (req.method === "GET") {
      try {
        return send(res, 200, { scenario: engine.readScenarioRaw(url.searchParams.get("id") || "", guestDir(entry)) });
      } catch (err) {
        return send(res, 404, { error: String(err.message || err) });
      }
    }
    const dir = ensureGuestDir(entry);
    const body = await readBody(req);
    try {
      let id = body.id;
      if (!entry.owner) {
        if (id) {
          if (!fs.existsSync(path.join(dir, `${id}.json`))) {
            return send(res, 403, { error: "只能编辑你自己创建的剧本。" });
          }
        } else {
          id = `g${entry.sid.slice(0, 6)}-${Date.now().toString(36)}`;
        }
      }
      const out = engine.saveCustomScenario(body.data || {}, id, dir);
      return send(res, 200, {
        ok: true,
        id: out.id,
        scenarios: engine.listScenarios(guestDir(entry)).map((s) => ({ ...s, editable: entry.owner ? s.custom : Boolean(s.guestOwned) })),
      });
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
  }
  if (req.method === "POST" && p === "/api/scenario/delete") {
    const dir = ensureGuestDir(entry);
    const body = await readBody(req);
    try {
      const id = String(body.id || "");
      if (!entry.owner && !fs.existsSync(path.join(dir, `${id}.json`))) {
        return send(res, 403, { error: "只能删除你自己创建的剧本。" });
      }
      engine.deleteCustomScenario(id, dir);
      return send(res, 200, {
        ok: true,
        scenarios: engine.listScenarios(guestDir(entry)).map((s) => ({ ...s, editable: entry.owner ? s.custom : Boolean(s.guestOwned) })),
      });
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
  }
  const presetDir = entry.owner ? engine.PRESET_DIR : path.join(engine.WORK, "users", `${entry.sid}-presets`);
  if (p === "/api/presets") {
    if (req.method === "GET") return send(res, 200, { presets: engine.listPresets(presetDir) });
    const body = await readBody(req);
    try {
      engine.savePreset(body.name, body.character || {}, presetDir);
      return send(res, 200, { ok: true, presets: engine.listPresets(presetDir) });
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
  }
  if (p === "/api/preset") {
    if (req.method === "GET") {
      try {
        return send(res, 200, engine.loadPreset(url.searchParams.get("name") || "", presetDir));
      } catch (err) {
        return send(res, 404, { error: String(err.message || err) });
      }
    }
    const body = await readBody(req);
    try {
      engine.deletePreset(String(body.name || ""), presetDir);
      return send(res, 200, { ok: true, presets: engine.listPresets(presetDir) });
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
  }
  if (p === "/api/state") {
    return send(res, 200, { session: publicSession(entry), busy: entry.busy, owner: entry.owner });
  }

  if (p === "/api/presence") {
    presence.set(entry.sid, Date.now());
    return send(res, 200, { online: onlineCount(), ...voteSnapshot(entry.sid) });
  }

  if (req.method === "POST" && p === "/api/vote") {
    const body = await readBody(req);
    const value = body.value === "down" ? "down" : body.value === "up" ? "up" : "";
    if (!value) return send(res, 400, { error: "投票类型无效" });
    const prev = votes.voters[entry.sid];
    if (prev === value) {
      delete votes.voters[entry.sid];
      votes[value] = Math.max(0, votes[value] - 1);
    } else {
      if (prev) votes[prev] = Math.max(0, votes[prev] - 1);
      votes.voters[entry.sid] = value;
      votes[value] += 1;
    }
    writeJsonFile(VOTES_FILE, votes);
    return send(res, 200, voteSnapshot(entry.sid));
  }

  if (p === "/api/feedback") {
    if (req.method === "GET") {
      const size = Math.min(20, Math.max(4, Number(url.searchParams.get("size")) || 8));
      const total = feedback.length;
      const pages = Math.max(1, Math.ceil(total / size));
      const page = Math.min(pages, Math.max(1, Number(url.searchParams.get("page")) || 1));
      const slice = feedback
        .slice()
        .reverse()
        .slice((page - 1) * size, page * size);
      const messages = slice.map((m) => {
        let prof = null;
        if (m.sid) {
          try {
            prof = loadProfileFor(m.sid);
          } catch {}
        }
        return {
          id: m.id,
          name: (prof && prof.name) || m.name || "匿名旅人",
          avatar: (prof && prof.avatar) || m.avatar || "",
          text: m.text,
          at: m.at,
          editedAt: m.editedAt || null,
          mine: Boolean(m.sid && m.sid === entry.sid),
        };
      });
      return send(res, 200, { messages, total, page, pages, size, ...voteSnapshot(entry.sid) });
    }
    const body = await readBody(req);
    const text = String(body.text || "").trim().slice(0, 500);
    if (!text) return send(res, 400, { error: "写点什么再发吧。" });
    const last = lastPostAt.get(entry.sid) || 0;
    if (Date.now() - last < 15000) return send(res, 429, { error: "发得太快了，歇一会儿再发。" });
    lastPostAt.set(entry.sid, Date.now());
    const prof = loadProfileFor(entry.sid);
    const message = {
      id: crypto.randomUUID(),
      sid: entry.sid,
      name: prof.name || "匿名旅人",
      avatar: prof.avatar || "",
      text,
      at: new Date().toISOString(),
      editedAt: null,
    };
    feedback.push(message);
    while (feedback.length > 500) feedback.shift();
    writeJsonFile(FEEDBACK_FILE, feedback);
    return send(res, 200, { ok: true, id: message.id });
  }

  if (req.method === "POST" && (p === "/api/feedback/edit" || p === "/api/feedback/delete")) {
    const body = await readBody(req);
    const msg = feedback.find((m) => m.id === String(body.id || ""));
    if (!msg) return send(res, 404, { error: "留言不存在" });
    if (msg.sid !== entry.sid) return send(res, 403, { error: "只能操作自己的留言" });
    if (p.endsWith("/delete")) {
      feedback = feedback.filter((m) => m.id !== msg.id);
    } else {
      const text = String(body.text || "").trim().slice(0, 500);
      if (!text) return send(res, 400, { error: "内容不能为空" });
      msg.text = text;
      msg.editedAt = new Date().toISOString();
    }
    writeJsonFile(FEEDBACK_FILE, feedback);
    return send(res, 200, { ok: true });
  }

  if (p === "/api/me") {
    if (req.method === "GET") return send(res, 200, loadProfileFor(entry.sid));
    const body = await readBody(req);
    return send(res, 200, saveProfileFor(entry.sid, body));
  }

  if (req.method === "POST" && p === "/api/upload") {
    const body = await readBody(req);
    try {
      const out = saveUpload(body.data, String(body.mime || ""), body.avatar ? AVATAR_MAX : UPLOAD_MAX);
      return send(res, 200, out);
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
  }

  if (req.method === "GET" && p.startsWith("/uploads/")) {
    const name = p.slice("/uploads/".length);
    if (!/^[a-f0-9]{16}\.(png|jpg|gif|webp|mp4|webm)$/i.test(name)) {
      return send(res, 404, "not found", "text/plain; charset=utf-8");
    }
    const file = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(file)) return send(res, 404, "not found", "text/plain; charset=utf-8");
    const ext = path.extname(name).slice(1).toLowerCase();
    const type =
      { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm" }[ext] ||
      "application/octet-stream";
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.setHeader("x-content-type-options", "nosniff");
    res.end(fs.readFileSync(file));
    return;
  }

  if (p === "/space" && req.method === "GET") {
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, "space.html"), "utf8"), "text/html; charset=utf-8");
  }

  if (p === "/api/community") {
    if (req.method === "GET") {
      const mine = url.searchParams.get("mine") === "1";
      const source = mine ? community.filter((x) => x.sid === entry.sid) : community;
      return send(res, 200, { posts: source.slice(-100).reverse().map((x) => communityView(x, entry.sid)) });
    }
    const body = await readBody(req);
    const title = String(body.title || "").trim().slice(0, 60);
    const text = String(body.text || "").trim().slice(0, 1000);
    if (!title && !text) return send(res, 400, { error: "写点标题或正文吧。" });
    const last = communityLast.get(entry.sid) || 0;
    if (Date.now() - last < 30000) return send(res, 429, { error: "发得太快了，歇一会儿再发。" });
    let media = null;
    if (body.media && body.media.url) {
      const mu = String(body.media.url);
      if (!/^\/uploads\/[a-f0-9]{16}\.(png|jpg|gif|webp|mp4|webm)$/i.test(mu)) {
        return send(res, 400, { error: "媒体地址无效" });
      }
      media = { url: mu, type: String(body.media.type || "") };
    }
    const profile = loadProfileFor(entry.sid);
    const post = {
      id: crypto.randomUUID(),
      sid: entry.sid,
      author: profile.name || "匿名旅人",
      avatar: profile.avatar || "",
      title,
      text,
      media,
      at: new Date().toISOString(),
      likes: [],
    };
    communityLast.set(entry.sid, Date.now());
    community.push(post);
    while (community.length > 200) community.shift();
    writeJsonFile(COMMUNITY_FILE, community);
    return send(res, 200, { ok: true, post: communityView(post, entry.sid) });
  }

  if (req.method === "POST" && p === "/api/community/like") {
    const body = await readBody(req);
    const post = community.find((x) => x.id === String(body.id || ""));
    if (!post) return send(res, 404, { error: "作品不存在" });
    post.likes = Array.isArray(post.likes) ? post.likes : [];
    const i = post.likes.indexOf(entry.sid);
    if (i >= 0) post.likes.splice(i, 1);
    else post.likes.push(entry.sid);
    writeJsonFile(COMMUNITY_FILE, community);
    return send(res, 200, communityView(post, entry.sid));
  }

  if (req.method === "POST" && p === "/api/scenario/share") {
    const body = await readBody(req);
    const sc = ownScenario(entry, String(body.id || ""));
    if (!sc) return send(res, 400, { error: "只能分享你自己创作的剧本。" });
    const last = communityLast.get(entry.sid) || 0;
    if (Date.now() - last < 30000) return send(res, 429, { error: "发得太快了，歇一会儿再分享。" });
    communityLast.set(entry.sid, Date.now());
    const profile = loadProfileFor(entry.sid);
    const post = {
      id: crypto.randomUUID(),
      type: "scenario",
      sid: entry.sid,
      pid: profile.pid || "",
      author: profile.name || "匿名旅人",
      avatar: profile.avatar || "",
      title: sc.title,
      text: sc.blurb || "",
      scenario: sc,
      media: null,
      at: new Date().toISOString(),
      likes: [],
    };
    community.push(post);
    while (community.length > 200) community.shift();
    writeJsonFile(COMMUNITY_FILE, community);
    return send(res, 200, { ok: true, post: communityView(post, entry.sid) });
  }

  if (req.method === "POST" && p === "/api/community/import") {
    const body = await readBody(req);
    const post = community.find((x) => x.id === String(body.postId || "") && x.type === "scenario");
    if (!post || !post.scenario) return send(res, 404, { error: "剧本不存在" });
    const dir = ownScenarioDir(entry);
    fs.mkdirSync(dir, { recursive: true });
    const id = `imp-${crypto.randomBytes(3).toString("hex")}-${Date.now().toString(36)}`;
    const data = { ...post.scenario, id, custom: true, importedFrom: post.pid || "" };
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(data, null, 2));
    return send(res, 200, { ok: true, id, title: data.title });
  }

  if (p === "/api/my-scenarios") {
    const list = listOwnScenarios(entry).map((s) => ({
      id: s.id,
      title: s.title,
      genre: s.genre || "",
      blurb: s.blurb || "",
      scheduleCount: (s.schedule || []).length,
      npcs: (s.npcs || []).length,
    }));
    return send(res, 200, { scenarios: list.sort((a, b) => a.title.localeCompare(b.title, "zh")) });
  }

  if (p === "/api/players") {
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const list = allProfiles()
      .filter((x) => !q || String(x.name || "").toLowerCase().includes(q) || String(x.bio || "").toLowerCase().includes(q))
      .slice(0, 30)
      .map((x) => ({
        pid: x.pid,
        name: x.name || "匿名旅人",
        avatar: x.avatar || "",
        bio: x.bio || "",
        posts: community.filter((c) => c.sid === x.sid).length,
      }));
    return send(res, 200, { players: list });
  }

  if (p === "/api/player") {
    const pid = String(url.searchParams.get("pid") || "");
    const prof = allProfiles().find((x) => x.pid === pid);
    if (!prof) return send(res, 404, { error: "找不到这位玩家" });
    const posts = community
      .filter((c) => c.sid === prof.sid)
      .slice(-50)
      .reverse()
      .map((c) => communityView(c, entry.sid));
    return send(res, 200, {
      pid: prof.pid,
      name: prof.name || "匿名旅人",
      avatar: prof.avatar || "",
      bio: prof.bio || "",
      posts,
    });
  }

  if (p === "/api/search") {
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    if (!q) return send(res, 200, { players: [], scenarios: [] });
    const players = allProfiles()
      .filter((x) => String(x.name || "").toLowerCase().includes(q) || String(x.bio || "").toLowerCase().includes(q))
      .slice(0, 10)
      .map((x) => ({ pid: x.pid, name: x.name || "匿名旅人", avatar: x.avatar || "", bio: x.bio || "" }));
    const scenarios = community
      .filter(
        (c) =>
          c.type === "scenario" &&
          [c.title, c.text, c.scenario?.genre, c.scenario?.blurb].some((v) => String(v || "").toLowerCase().includes(q))
      )
      .slice(-20)
      .reverse()
      .map((c) => communityView(c, entry.sid));
    return send(res, 200, { players, scenarios });
  }

  if (p === "/room" && req.method === "GET") {
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, "room.html"), "utf8"), "text/html; charset=utf-8");
  }

  if (req.method === "POST" && p === "/api/rooms/create") {
    const body = await readBody(req);
    const sc = engine.loadScenario(String(body.scenarioId || ""), guestDir(entry));
    if (!sc) return send(res, 400, { error: "剧本不存在" });
    let prof = loadProfileFor(entry.sid);
    if (!prof.pid) prof = saveProfileFor(entry.sid, {});
    const cut = Date.now() - 24 * 3600 * 1000;
    for (const [code, room] of Object.entries(rooms)) {
      if ((room.updatedAt || room.createdAt || 0) < cut) delete rooms[code];
    }
    const code = makeRoomCode();
    const room = {
      code,
      hostSid: entry.sid,
      hostPid: prof.pid,
      scenario: sc,
      mode: body.mode === "free" ? "free" : "trpg",
      difficulty: ["easy", "normal", "hard"].includes(body.difficulty) ? body.difficulty : "normal",
      opening: String(body.opening || "").slice(0, 500),
      status: "lobby",
      players: [
        {
          sid: entry.sid,
          pid: prof.pid,
          name: prof.name || "匿名旅人",
          avatar: prof.avatar || "",
          character: sanitizeRoomCharacter(body.character, prof.name),
        },
      ],
      actions: {},
      log: [],
      state: newRoomState(),
      turn: 0,
      busy: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    room.state.status[room.players[0].pid] = initRoomStatus(room.players[0].character);
    rooms[code] = room;
    saveRooms();
    return send(res, 200, { ok: true, code, room: publicRoom(room, entry.sid) });
  }

  if (req.method === "POST" && p === "/api/rooms/join") {
    const body = await readBody(req);
    const code = String(body.code || "").trim().toUpperCase();
    const room = rooms[code];
    if (!room) return send(res, 404, { error: "房间不存在" });
    if (room.status !== "lobby") return send(res, 400, { error: "这局已经开始，等下一局吧" });
    if (room.players.length >= 6) return send(res, 400, { error: "房间满了（最多 6 人）" });
    let prof = loadProfileFor(entry.sid);
    if (!prof.pid) prof = saveProfileFor(entry.sid, {});
    if (!room.players.some((p) => p.sid === entry.sid)) {
      const character = sanitizeRoomCharacter(body.character, prof.name);
      room.players.push({
        sid: entry.sid,
        pid: prof.pid,
        name: prof.name || "匿名旅人",
        avatar: prof.avatar || "",
        character,
      });
      room.state.status[prof.pid] = initRoomStatus(character);
    }
    room.updatedAt = Date.now();
    saveRooms();
    return send(res, 200, { ok: true, room: publicRoom(room, entry.sid) });
  }

  if (p === "/api/rooms/state") {
    const room = rooms[String(url.searchParams.get("code") || "").trim().toUpperCase()];
    if (!room) return send(res, 404, { error: "房间不存在" });
    return send(res, 200, { room: publicRoom(room, entry.sid) });
  }

  if (req.method === "POST" && p === "/api/rooms/start") {
    const body = await readBody(req);
    const room = rooms[String(body.code || "").trim().toUpperCase()];
    if (!room) return send(res, 404, { error: "房间不存在" });
    if (room.hostSid !== entry.sid) return send(res, 403, { error: "只有房主可以开始" });
    room.status = "playing";
    if (room.opening) {
      room.log.push({ type: "gm", text: room.opening, at: Date.now() });
    }
    room.log.push({ type: "sys", text: "游戏开始，请每位玩家写下自己的行动。", at: Date.now() });
    room.updatedAt = Date.now();
    saveRooms();
    return send(res, 200, { ok: true, room: publicRoom(room, entry.sid) });
  }

  if (req.method === "POST" && p === "/api/rooms/action") {
    const body = await readBody(req);
    const room = rooms[String(body.code || "").trim().toUpperCase()];
    if (!room) return send(res, 404, { error: "房间不存在" });
    if (room.status !== "playing") return send(res, 400, { error: "游戏还没开始" });
    const player = room.players.find((p) => p.sid === entry.sid);
    if (!player) return send(res, 403, { error: "你不在这个房间里" });
    const text = String(body.text || "").trim().slice(0, 500);
    if (!text) return send(res, 400, { error: "先写行动" });
    room.actions[entry.sid] = text;
    room.log.push({ type: "player", who: player.character.name, text, at: Date.now() });
    room.updatedAt = Date.now();
    saveRooms();
    return send(res, 200, { ok: true, room: publicRoom(room, entry.sid) });
  }

  if (req.method === "POST" && p === "/api/rooms/advance") {
    const body = await readBody(req);
    const room = rooms[String(body.code || "").trim().toUpperCase()];
    if (!room) return send(res, 404, { error: "房间不存在" });
    if (room.hostSid !== entry.sid) return send(res, 403, { error: "只有房主可以推进剧情" });
    if (room.status !== "playing") return send(res, 400, { error: "游戏还没开始" });
    if (room.busy) return send(res, 429, { error: "正在推演，稍等" });
    if (!Object.keys(room.actions).length) return send(res, 400, { error: "还没有人提交行动" });
    room.busy = true;
    try {
      const result = await engine.askModel(roomPrompt(room), { reasoningEffort: "low" });
      const parsed = engine.parseModelTurn(result.text);
      const narration = parsed.narrative || String(result.text || "").slice(0, 4000);
      if (narration) room.log.push({ type: "gm", text: narration, at: Date.now() });
      applyRoomState(room, parsed.state || {});
      room.turn += 1;
      room.actions = {};
      room.updatedAt = Date.now();
      saveRooms();
      return send(res, 200, { ok: true, room: publicRoom(room, entry.sid) });
    } catch (err) {
      saveRooms();
      return send(res, 500, { error: `推演失败：${err.message}` });
    } finally {
      room.busy = false;
    }
  }

  if (req.method === "POST" && p === "/api/rooms/leave") {
    const body = await readBody(req);
    const room = rooms[String(body.code || "").trim().toUpperCase()];
    if (!room) return send(res, 404, { error: "房间不存在" });
    room.players = room.players.filter((p) => p.sid !== entry.sid);
    delete room.actions[entry.sid];
    if (!room.players.length) delete rooms[room.code];
    else if (room.hostSid === entry.sid) {
      room.hostSid = room.players[0].sid;
      room.hostPid = room.players[0].pid;
    }
    saveRooms();
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && p === "/api/rooms/close") {
    const body = await readBody(req);
    const room = rooms[String(body.code || "").trim().toUpperCase()];
    if (!room) return send(res, 404, { error: "房间不存在" });
    if (room.hostSid !== entry.sid) return send(res, 403, { error: "只有房主可以解散" });
    delete rooms[room.code];
    saveRooms();
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && p === "/api/save/import") {
    const body = await readBody(req);
    const s = body.session || body;
    if (!s || typeof s !== "object" || !s.character || !s.scenarioId || !Array.isArray(s.log)) {
      return send(res, 400, { error: "这不是有效的跑团存档文件。" });
    }
    const scenario = engine.loadScenario(String(s.scenarioId), guestDir(entry));
    if (!scenario) return send(res, 400, { error: "存档对应的剧本已经不存在。" });
    entry.session = s;
    entry.busy = false;
    saveEntry(entry);
    return send(res, 200, { ok: true, session: publicSession(entry) });
  }

  if (req.method === "POST" && p === "/api/quit") {
    if (!entry.owner) return send(res, 403, { error: "访客不能关闭服务。" });
    send(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 150);
    return;
  }
  if (req.method === "POST" && p === "/api/reset") {
    clearEntry(entry);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && p === "/api/new") {
    if (entry.busy) return send(res, 429, { error: "上一回合还在进行中，稍等。" });
    if (!entry.owner && guestQuotaLeft() <= 0) {
      return send(res, 429, { error: "今天大家的试玩额度已经用完了，明天再来吧。" });
    }
    const body = await readBody(req);
    let fresh;
    try {
      fresh = engine.createSession({
        character: body.character || {},
        scenarioId: body.scenarioId,
        difficulty: body.difficulty || "normal",
        mode: body.mode,
        scenarioDir: guestDir(entry),
      });
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
    const scenario = engine.loadScenario(fresh.scenarioId, guestDir(entry));
    entry.session = fresh;
    entry.busy = true;
    await acquireSlot();
    if (!entry.owner) addGuestCalls(1);
    try {
      const opening = await engine.runOpening(entry.session, scenario);
      saveEntry(entry);
      return send(res, 200, { session: publicSession(entry), segments: opening.segments });
    } catch (err) {
      saveEntry(entry);
      return send(res, 200, {
        session: publicSession(entry),
        segments: [{ type: "sys", text: `开场没能生成：${err.message}。可以直接输入第一个行动试试。` }],
      });
    } finally {
      entry.busy = false;
      releaseSlot();
    }
  }

  if (req.method === "POST" && p === "/api/action") {
    if (!entry.session) return send(res, 400, { error: "还没有开始游戏。" });
    if (entry.busy) return send(res, 429, { error: "上一回合还在进行中。" });
    if (!entry.owner && entry.session.turns >= guestTurnLimit) {
      return send(res, 403, { error: `试玩到这里啦：每位访客最多 ${guestTurnLimit} 回合。` });
    }
    if (!entry.owner && guestQuotaLeft() <= 0) {
      return send(res, 429, { error: "今天大家的试玩额度已经用完了，明天再来吧。" });
    }
    const body = await readBody(req);
    const text = String(body.text || "").trim().slice(0, 500);
    if (!text) return send(res, 400, { error: "先说要做的事。" });
    const scenario = engine.loadScenario(entry.session.scenarioId, guestDir(entry));
    if (!scenario) return send(res, 500, { error: "剧本文件读不到了。" });
    entry.busy = true;
    await acquireSlot();
    if (!entry.owner) addGuestCalls(1);
    try {
      const out = await engine.runTurn(entry.session, scenario, text);
      if (!entry.owner && out.segments.some((s) => s.type === "dice")) addGuestCalls(1);
      saveEntry(entry);
      return send(res, 200, { session: publicSession(entry), segments: out.segments });
    } catch (err) {
      saveEntry(entry);
      return send(res, 500, { error: `这一回合出了问题：${err.message}` });
    } finally {
      entry.busy = false;
      releaseSlot();
    }
  }

  if (req.method === "POST" && p === "/api/roll") {
    if (!entry.session) return send(res, 400, { error: "还没有开始游戏。" });
    const body = await readBody(req);
    const skill = String(body.skill || "侦查");
    const dc = Number(body.dc) || 15;
    const result = engine.rollCheck(entry.session.character, skill, dc, entry.session.difficulty);
    const line = `${result.skill}（主动判定）：d20=${result.roll}＋技能${result.skillBonus}=${result.total}　难度${result.dc}　${result.grade}`;
    entry.session.log.push({ type: "dice", text: line });
    saveEntry(entry);
    return send(res, 200, {
      result,
      segments: [{ type: "dice", text: line, grade: result.grade }],
      session: publicSession(entry),
    });
  }

  return send(res, 404, "not found", "text/plain; charset=utf-8");
});

/* 定期清理内存里闲置的访客（存档文件保留，下次带同一 cookie 回来还能接着玩） */
setInterval(() => {
  const now = Date.now();
  for (const [sid, entry] of store) {
    if (entry.owner || entry.busy) continue;
    if (now - entry.lastSeen > 6 * 3600 * 1000) store.delete(sid);
  }
  if (store.size > 60) {
    const victims = [...store.values()]
      .filter((e) => !e.owner && !e.busy)
      .sort((a, b) => a.lastSeen - b.lastSeen)
      .slice(0, store.size - 60);
    victims.forEach((v) => store.delete(v.sid));
  }
}, 10 * 60 * 1000).unref();

/* ---------- 启动 ---------- */

const HOST = engine.config.bindHost || "127.0.0.1";
let actualPort = engine.config.port;

function start(port, retries) {
  const onError = (err) => {
    if (err.code === "EADDRINUSE" && retries > 0) {
      server.removeListener("error", onError);
      actualPort = port + 1;
      start(actualPort, retries - 1);
      return;
    }
    console.error(`启动失败：${err.message}`);
    process.exit(1);
  };
  server.once("error", onError);
  server.listen(port, HOST, () => {
    server.removeListener("error", onError);
    actualPort = port;
    try {
      fs.writeFileSync(
        STATE_FILE,
        JSON.stringify({ pid: process.pid, port, host: HOST, url: `http://127.0.0.1:${port}`, model: engine.config.model }, null, 2)
      );
    } catch {}
    console.log(`跑团面板已启动：http://127.0.0.1:${port}`);
    if (HOST === "0.0.0.0") console.log(`局域网访问：http://<本机IP>:${port}`);
    console.log(`模型：${engine.config.model}`);
    console.log(`邀请码：${shareKey || "（未设置，任何人都能进）"}`);
  });
}

start(engine.config.port, 12);
