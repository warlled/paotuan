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
fs.mkdirSync(SESS_DIR, { recursive: true });

const shareKey = String(engine.config.shareKey || "").trim();
const guestTurnLimit = Number(engine.config.guestTurnLimit) || 60;
const guestDailyCalls = Number(engine.config.guestDailyCalls) || 150;
const maxConcurrentModels = Number(engine.config.maxConcurrentModels) || 2;

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

function ctxFor(req, res) {
  if (isLocal(req)) {
    return { entry: getEntry("owner", true), local: true };
  }
  const url = new URL(req.url, "http://x");
  const cookies = parseCookies(req.headers.cookie);
  if (shareKey) {
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

  const ctx = ctxFor(req, res);
  if (ctx.denied) return send(res, 403, denyPage(), "text/html; charset=utf-8");
  const entry = ctx.entry;

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8"), "text/html; charset=utf-8");
  }
  if (req.method === "GET" && (p === "/app.js" || p === "/style.css")) {
    const type = p.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
    if (!fs.existsSync(path.join(PUBLIC, p))) return send(res, 404, "not found", "text/plain; charset=utf-8");
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, p), "utf8"), type);
  }
  if (p === "/api/ping") {
    return send(res, 200, { ok: true, model: engine.config.model, shared: Boolean(shareKey) });
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
