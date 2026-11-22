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
fs.mkdirSync(SESS_DIR, { recursive: true });

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
  const adminPath = url.pathname === "/admin" || url.pathname === "/admin/login" || url.pathname === "/admin/logout" || url.pathname === "/admin/owner" || url.pathname === "/admin/owner/off" || url.pathname === "/api/admin/state";
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
  if (p === "/api/presets") {
    if (req.method === "GET") return send(res, 200, { presets: entry.owner ? engine.listPresets() : [] });
    if (!entry.owner) return send(res, 403, { error: "访客不能保存角色预设。" });
    const body = await readBody(req);
    try {
      engine.savePreset(body.name, body.character || {});
      return send(res, 200, { ok: true, presets: engine.listPresets() });
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
  }
  if (p === "/api/preset") {
    if (!entry.owner) return send(res, 403, { error: "访客不能读取角色预设。" });
    if (req.method === "GET") {
      try {
        return send(res, 200, engine.loadPreset(url.searchParams.get("name") || ""));
      } catch (err) {
        return send(res, 404, { error: String(err.message || err) });
      }
    }
    const body = await readBody(req);
    try {
      engine.deletePreset(String(body.name || ""));
      return send(res, 200, { ok: true, presets: engine.listPresets() });
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
      return send(res, 200, {
        messages: feedback.slice(-200).reverse(),
        ...voteSnapshot(entry.sid),
      });
    }
    const body = await readBody(req);
    const text = String(body.text || "").trim().slice(0, 500);
    const name = String(body.name || "").trim().slice(0, 24) || "匿名旅人";
    if (!text) return send(res, 400, { error: "写点什么再发吧。" });
    const last = lastPostAt.get(entry.sid) || 0;
    if (Date.now() - last < 15000) return send(res, 429, { error: "发得太快了，歇一会儿再发。" });
    lastPostAt.set(entry.sid, Date.now());
    const message = { id: crypto.randomUUID(), name, text, at: new Date().toISOString() };
    feedback.push(message);
    while (feedback.length > 500) feedback.shift();
    writeJsonFile(FEEDBACK_FILE, feedback);
    return send(res, 200, { ok: true, message });
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
      });
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
    const scenario = engine.loadScenario(fresh.scenarioId);
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
    const scenario = engine.loadScenario(entry.session.scenarioId);
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
