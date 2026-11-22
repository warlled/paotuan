/**
 * 跑团规则引擎
 * 职责：骰子、时间推进、角色数值、剧本日程、状态存档，以及与模型（GM）的来回。
 * 关键设计：模型只负责叙述和提出判定请求，随机结果一律由这里的骰子决定。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const https = require("node:https");
const { linksToPromptBlock, MAX_LINKS } = require("./linkfetch");

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : "";
const WORK = DATA_DIR || path.join(ROOT, "work");
const SCENARIO_DIR = path.join(ROOT, "剧本");
const USER_SCENARIO_DIR = DATA_DIR ? path.join(WORK, "scenarios") : SCENARIO_DIR;
const PRESET_DIR = DATA_DIR ? path.join(WORK, "presets") : path.join(ROOT, "角色");
const SETTINGS_FILE = path.join(WORK, "settings.json");
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(PRESET_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  } catch {
    return fallback;
  }
}

const fileConfig = readJson("config.json", {});
const envConfig = {};
if (process.env.PORT) envConfig.port = Number(process.env.PORT);
if (process.env.BIND_HOST) envConfig.bindHost = process.env.BIND_HOST;
if (process.env.MODEL_PROVIDER) envConfig.provider = process.env.MODEL_PROVIDER;
if (process.env.MODEL_NAME) envConfig.model = process.env.MODEL_NAME;
if (process.env.DEEPSEEK_API_KEY) envConfig.apiKey = process.env.DEEPSEEK_API_KEY;
if (process.env.SHARE_KEY) envConfig.shareKey = process.env.SHARE_KEY;
if (process.env.GUEST_TURN_LIMIT) envConfig.guestTurnLimit = Number(process.env.GUEST_TURN_LIMIT);
if (process.env.GUEST_DAILY_CALLS) envConfig.guestDailyCalls = Number(process.env.GUEST_DAILY_CALLS);
if (process.env.MAX_CONCURRENT_MODELS) envConfig.maxConcurrentModels = Number(process.env.MAX_CONCURRENT_MODELS);

const config = {
  model: "deepseek-v4-flash",
  reasoningEffort: "low",
  port: 8890,
  provider: "codex",
  maxOutputTokens: 2000,
  ...fileConfig,
  ...envConfig,
};

const CODEX_EXE =
  process.env.LOCAL_CHAT_CODEX ||
  path.join(
    os.homedir(),
    "AppData", "Roaming", "npm", "node_modules", "@openai", "codex",
    "node_modules", "@openai", "codex-win32-x64", "vendor",
    "x86_64-pc-windows-msvc", "bin", "codex.exe"
  );

const ATTRS = [
  { key: "str", label: "力量", desc: "体力、格斗、搬运重物" },
  { key: "dex", label: "敏捷", desc: "身手、潜行、反应速度" },
  { key: "con", label: "体质", desc: "耐力、抗伤、意志力" },
  { key: "int", label: "智力", desc: "推理、学识、医术" },
  { key: "per", label: "感知", desc: "观察、聆听、直觉" },
  { key: "cha", label: "魅力", desc: "话术、交际、气场" },
];

const SKILLS = [
  { name: "侦查", attr: "per", desc: "发现细节、搜查线索" },
  { name: "聆听", attr: "per", desc: "听见动静、辨别声响" },
  { name: "话术", attr: "cha", desc: "套话、说服、安抚" },
  { name: "威吓", attr: "cha", desc: "施压、震慑、逼问" },
  { name: "格斗", attr: "str", desc: "近身搏斗、制伏" },
  { name: "潜行", attr: "dex", desc: "隐匿、跟踪、开锁" },
  { name: "身手", attr: "dex", desc: "攀爬、闪避、精细操作" },
  { name: "学识", attr: "int", desc: "文献、药理、推理验证" },
  { name: "医术", attr: "int", desc: "疗伤、验尸、诊断" },
  { name: "意志", attr: "con", desc: "抵抗恐惧、精神压迫" },
];

const DIFFICULTY = {
  easy: { label: "轻松", dcShift: -3, hpShift: 6, sanShift: 6, hint: "判定更容易，容错高" },
  normal: { label: "标准", dcShift: 0, hpShift: 0, sanShift: 0, hint: "常规难度" },
  hard: { label: "硬核", dcShift: 3, hpShift: -6, sanShift: -6, hint: "判定更难，掉血掉理智更狠" },
};

const ATTR_POINTS = 30;
const ATTR_MIN = 1;
const ATTR_MAX = 10;

const DEFAULT_SETTINGS = {
  narrativeLength: "标准",
  reasoningEffort: config.reasoningEffort,
  allowCritFail: true,
  autoAdvanceMinutes: 10,
  extraInstructions: "",
  links: [],
};

const NARRATIVE_LENGTH = {
  简短: "每回合正文控制在 2 段以内，节奏快，少写环境铺陈。",
  标准: "每回合正文 2 到 4 段，兼顾氛围与推进。",
  详细: "每回合正文 4 到 6 段，环境、动作、心理都可铺开写，但不要拖沓。",
};

/* ---------- 设定 ---------- */

function getSettings() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {}
  const merged = { ...DEFAULT_SETTINGS, ...saved };
  if (!NARRATIVE_LENGTH[merged.narrativeLength]) merged.narrativeLength = "标准";
  if (!["low", "medium", "high"].includes(merged.reasoningEffort)) merged.reasoningEffort = config.reasoningEffort;
  merged.autoAdvanceMinutes = Math.max(0, Math.min(240, Number(merged.autoAdvanceMinutes) || 0));
  merged.extraInstructions = String(merged.extraInstructions || "").slice(0, 1200);
  merged.links = sanitizeLinks(merged.links);
  return merged;
}

function saveSettings(patch) {
  const next = { ...getSettings(), ...(patch || {}) };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return getSettings();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 剧本 ---------- */

/** 访客私有剧本目录排在最前，其后才是宿主机的公共剧本目录。 */
function scenarioDirs(extraDir) {
  const dirs = [];
  if (extraDir && path.resolve(extraDir) !== path.resolve(SCENARIO_DIR)) dirs.push(extraDir);
  if (
    path.resolve(USER_SCENARIO_DIR) !== path.resolve(SCENARIO_DIR) &&
    !dirs.some((d) => path.resolve(d) === path.resolve(USER_SCENARIO_DIR))
  ) {
    dirs.push(USER_SCENARIO_DIR);
  }
  dirs.push(SCENARIO_DIR);
  return dirs;
}

function readScenarioDir(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

function listScenarios(extraDir) {
  const seen = new Set();
  const out = [];
  for (const dir of scenarioDirs(extraDir)) {
    const isExtra = path.resolve(dir) !== path.resolve(SCENARIO_DIR);
    for (const f of readScenarioDir(dir)) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const id = data.id || path.basename(f, ".json");
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          title: data.title || path.basename(f, ".json"),
          genre: data.genre || "",
          blurb: data.blurb || "",
          players: data.players || "单人",
          scheduleCount: (data.schedule || []).length,
          custom: Boolean(data.custom),
          guestOwned: isExtra,
          hasOpening: Boolean(data.opening),
          linksCount: (data.links || []).length,
        });
      } catch {}
    }
  }
  return out;
}

function loadScenario(id, extraDir) {
  for (const dir of scenarioDirs(extraDir)) {
    for (const f of readScenarioDir(dir)) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        if ((data.id || path.basename(f, ".json")) === id) return data;
      } catch {}
    }
  }
  return null;
}

const NAME_RULE = /^[\w\u4e00-\u9fa5-]{1,40}$/;

/* 自定义内容的长度上限：保证单次调用的提示词规模可控（详见 说明.txt 的「负载上限」）*/
const CLI = {
  title: 60,
  genre: 40,
  blurb: 200,
  tone: 200,
  background: 4000,
  hook: 1000,
  opening: 4000,
  truth: 3000,
  npcName: 30,
  npcDesc: 300,
  npcSecret: 300,
  npcCount: 30,
  clue: 120,
  clueCount: 40,
  eventTitle: 40,
  eventNote: 200,
  eventCount: 60,
  endingName: 40,
  endingCondition: 200,
  endingCount: 12,
  item: 30,
  itemCount: 20,
  characterField: 400,
  characterName: 40,
};

const clip = (value, limit) => String(value ?? "").trim().slice(0, limit);

/** 外部链接抓取结果的统一整理：最多 5 条，每条正文最多 5000 字。 */
function sanitizeLinks(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      const url = clip(item?.url, 500);
      return {
        url,
        title: clip(item?.title, 120) || url,
        text: clip(item?.text, 5000),
        chars: clip(item?.text, 5000).length,
        fetchedAt: clip(item?.fetchedAt, 40),
      };
    })
    .filter((item) => item.url && item.text)
    .slice(0, MAX_LINKS);
}

/** 把界面上填的自定义剧本写进「剧本」文件夹。传 id 就是覆盖已有剧本。 */
function saveCustomScenario(input, existingId, targetDir) {
  const dir = targetDir || USER_SCENARIO_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const title = clip(input.title, CLI.title);
  if (!title) throw new Error("剧本标题不能为空");
  const background = clip(input.background, CLI.background);
  if (!background) throw new Error("至少要写一段背景");
  let id = String(existingId || input.id || "").trim();
  if (!id) id = `custom-${Date.now().toString(36)}`;
  if (!NAME_RULE.test(id)) throw new Error("剧本文件名只能用中文、字母、数字、下划线或短横线");

  const cleanList = (arr, limit, count) =>
    (Array.isArray(arr) ? arr.map((x) => clip(x, limit)).filter(Boolean).slice(0, count) : []);
  const schedule = (Array.isArray(input.schedule) ? input.schedule : [])
    .map((ev) => ({
      day: Math.max(1, Math.floor(Number(ev.day) || 1)),
      minute: Math.max(0, Math.min(1439, Math.floor(Number(ev.minute) || 0))),
      title: clip(ev.title, CLI.eventTitle),
      note: clip(ev.note, CLI.eventNote),
    }))
    .filter((ev) => ev.title)
    .sort((a, b) => a.day * 1440 + a.minute - (b.day * 1440 + b.minute))
    .slice(0, CLI.eventCount);

  const npcs = (Array.isArray(input.npcs) ? input.npcs : [])
    .map((n) => ({
      name: clip(n.name, CLI.npcName),
      desc: clip(n.desc, CLI.npcDesc),
      secret: clip(n.secret, CLI.npcSecret),
    }))
    .filter((n) => n.name)
    .slice(0, CLI.npcCount);

  const endings = (Array.isArray(input.endings) ? input.endings : [])
    .map((e) => ({ name: clip(e.name, CLI.endingName), condition: clip(e.condition, CLI.endingCondition) }))
    .filter((e) => e.name)
    .slice(0, CLI.endingCount);

  const data = {
    id,
    title,
    genre: clip(input.genre, CLI.genre) || "自定义",
    blurb: clip(input.blurb, CLI.blurb) || background.slice(0, 80),
    tone: clip(input.tone, CLI.tone) || "由玩家设定",
    background,
    hook: clip(input.hook, CLI.hook),
    opening: clip(input.opening, CLI.opening),
    truth: clip(input.truth, CLI.truth) || "（玩家未指定，请自行设计一个合理的内幕并保持前后一致）",
    clues: cleanList(input.clues, CLI.clue, CLI.clueCount),
    npcs,
    schedule,
    endings: endings.length ? endings : [{ name: "自由结局", condition: "由剧情自然收束" }],
    startDay: Math.max(1, Math.floor(Number(input.startDay) || 1)),
    startMinute: Math.max(0, Math.min(1439, Math.floor(Number(input.startMinute) ?? 9 * 60))),
    startMoney: Math.max(0, Math.floor(Number(input.startMoney) || 0)),
    startItems: cleanList(input.startItems, CLI.item, CLI.itemCount),
    links: sanitizeLinks(input.links),
    custom: true,
  };

  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(data, null, 2), "utf8");
  return { id, data };
}

function readScenarioRaw(id, extraDir) {
  const scenario = loadScenario(id, extraDir);
  if (!scenario) throw new Error("找不到这个剧本");
  return scenario;
}

function deleteCustomScenario(id, extraDir) {
  const dirs = [extraDir || USER_SCENARIO_DIR];
  const scenario = loadScenario(id, extraDir);
  if (!scenario) throw new Error("找不到这个剧本");
  if (!scenario.custom) throw new Error("内置剧本不能删除");
  const file = path.join(dirs[0], `${id}.json`);
  if (!fs.existsSync(file)) throw new Error("找不到这个剧本");
  fs.unlinkSync(file);
  if (fs.existsSync(file)) throw new Error("删除失败，文件可能被占用");
  return true;
}

/* ---------- 角色预设 ---------- */

function listPresets() {
  let files = [];
  try {
    files = fs.readdirSync(PRESET_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, f), "utf8"));
        return {
          name: data.name || path.basename(f, ".json"),
          role: data.character?.role || "",
          summary: [data.character?.gender, data.character?.age].filter(Boolean).join(" · "),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function savePreset(name, character) {
  const clean = String(name || character?.name || "").trim();
  if (!clean) throw new Error("预设名字不能为空");
  if (!NAME_RULE.test(clean)) throw new Error("预设名只能用中文、字母、数字、下划线或短横线");
  fs.writeFileSync(
    path.join(PRESET_DIR, `${clean}.json`),
    JSON.stringify({ name: clean, character }, null, 2),
    "utf8"
  );
  return clean;
}

function loadPreset(name) {
  const clean = String(name || "").trim();
  if (!NAME_RULE.test(clean)) throw new Error("预设名不合法");
  try {
    return JSON.parse(fs.readFileSync(path.join(PRESET_DIR, `${clean}.json`), "utf8"));
  } catch {
    throw new Error("找不到这个角色预设");
  }
}

function deletePreset(name) {
  const clean = String(name || "").trim();
  if (!NAME_RULE.test(clean)) throw new Error("预设名不合法");
  const file = path.join(PRESET_DIR, `${clean}.json`);
  if (!fs.existsSync(file)) throw new Error("找不到这个角色预设");
  fs.unlinkSync(file);
  if (fs.existsSync(file)) throw new Error("删除失败，文件可能被占用");
  return true;
}

/* ---------- 日志上限 ---------- */

const LOG_KEEP = 800;
const LOG_TRIM_AT = 1200;

function archiveOldLog(session) {
  if (!Array.isArray(session.log) || session.log.length < LOG_TRIM_AT) return;
  const cut = session.log.length - LOG_KEEP;
  const stamp = String(session.createdAt || Date.now()).replace(/[:.]/g, "-");
  const file = path.join(WORK, `log-${stamp}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(session.log.slice(0, cut), null, 2), "utf8");
    session.log = session.log.slice(cut);
    session.logTrimmed = (session.logTrimmed || 0) + cut;
  } catch {}
}

/* ---------- 骰子 ---------- */

function d(sides) {
  return 1 + Math.floor(Math.random() * sides);
}

function skillValue(character, skillName) {
  const skill = SKILLS.find((s) => s.name === skillName);
  const attrKey = skill ? skill.attr : "per";
  return character.attrs?.[attrKey] ?? 5;
}

function rollCheck(character, skillName, dc, difficulty) {
  const shift = (DIFFICULTY[difficulty] || DIFFICULTY.normal).dcShift;
  const finalDc = Math.max(5, Math.min(30, Number(dc || 15) + shift));
  const roll = d(20);
  const skill = skillValue(character, skillName);
  const total = roll + skill;
  let grade;
  if (roll === 20) grade = "大成功";
  else if (roll === 1) grade = "大失败";
  else if (total >= finalDc + 5) grade = "出色成功";
  else if (total >= finalDc) grade = "成功";
  else grade = "失败";
  return { skill: skillName, roll, skillBonus: skill, total, dc: finalDc, grade, ok: total >= finalDc && roll !== 1 };
}

/* ---------- 时间与日程 ---------- */

function clockText(time) {
  const h = Math.floor(time.minute / 60);
  const m = time.minute % 60;
  return `第 ${time.day} 天 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function eventKey(ev, index) {
  return `${ev.day}-${ev.minute}-${index}`;
}

function advanceTime(session, scenario, minutes) {
  const m = Math.max(0, Math.min(24 * 60, Number(minutes) || 0));
  session.time.minute += m;
  while (session.time.minute >= 1440) {
    session.time.minute -= 1440;
    session.time.day += 1;
  }
  const fired = [];
  (scenario.schedule || []).forEach((ev, index) => {
    const key = eventKey(ev, index);
    if (session.firedEvents.includes(key)) return;
    const passed =
      session.time.day > ev.day ||
      (session.time.day === ev.day && session.time.minute >= ev.minute);
    if (passed) {
      session.firedEvents.push(key);
      if (!Array.isArray(session.eventLog)) session.eventLog = [];
      session.eventLog.push({
        day: ev.day,
        minute: ev.minute,
        title: ev.title,
        note: ev.note || "",
        at: clockText(session.time),
      });
      fired.push({ ...ev, key });
    }
  });
  return fired;
}

function upcomingEvents(session, scenario) {
  const out = [];
  (scenario.schedule || []).forEach((ev, index) => {
    const key = eventKey(ev, index);
    if (session.firedEvents.includes(key)) return;
    const nowAbs = session.time.day * 1440 + session.time.minute;
    const evAbs = ev.day * 1440 + ev.minute;
    out.push({ ...ev, key, minutesAway: evAbs - nowAbs });
  });
  out.sort((a, b) => a.minutesAway - b.minutesAway);
  return out;
}

function humanDuration(minutes) {
  if (minutes <= 0) return "就是现在";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `还有 ${m} 分钟`;
  if (m === 0) return `还有 ${h} 小时`;
  return `还有 ${h} 小时 ${m} 分`;
}

/* ---------- 模型调用 ---------- */

function askCodex(prompt, settings) {
  const effort = settings?.reasoningEffort || getSettings().reasoningEffort;
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CODEX_EXE)) {
      reject(new Error(`找不到模型程序：${CODEX_EXE}`));
      return;
    }
    const args = [
      "--sandbox", "read-only",
      "--ask-for-approval", "never",
      "-C", WORK,
      "--model", config.model,
      "-c", `model_reasoning_effort="${effort}"`,
      "-c", "allow_login_shell=false",
      "--disable", "apps",
      "--disable", "shell_tool",
      "--disable", "computer_use",
      "exec", "--json", "--ephemeral", "--skip-git-repo-check", "-",
    ];
    const child = spawn(CODEX_EXE, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, USERPROFILE: os.homedir(), HOME: os.homedir() },
    });
    let text = "";
    let stderr = "";
    let buffered = "";
    let usage = null;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error("模型 150 秒内没有返回。"));
    }, 150000);
    child.stdout.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        let evt;
        try {
          evt = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (evt.type === "item.completed" && evt.item?.type === "agent_message") {
          text += (text ? "\n\n" : "") + evt.item.text.trim();
        }
        if (evt.type === "turn.completed" && evt.usage) usage = evt.usage;
      }
    });
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      finish(reject, err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (text.trim()) finish(resolve, { text: text.trim(), usage });
      else finish(reject, new Error(`模型没有回复（退出码 ${code}）。${stderr.trim().split(/\r?\n/).slice(-4).join("\n")}`));
    });
    child.stdin.end(prompt, "utf8");
  });
}

/** 云端模式：直接调用 DeepSeek 官方 API，无需本机 Codex。 */
function askDeepSeek(prompt, settings) {
  return new Promise((resolve, reject) => {
    const key = config.apiKey || process.env.DEEPSEEK_API_KEY;
    if (!key) {
      reject(new Error("缺少 DEEPSEEK_API_KEY 环境变量"));
      return;
    }
    const known = /^deepseek-(chat|reasoner|coder)/.test(String(config.model || ""));
    const model = known ? config.model : process.env.DEEPSEEK_MODEL || "deepseek-chat";
    const payload = JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是一位跑团主持人（GM）。严格按用户消息里给出的格式要求输出，不要解释规则。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.9,
      max_tokens: Number(config.maxOutputTokens) || 2000,
      stream: false,
    });
    const req = https.request(
      {
        hostname: "api.deepseek.com",
        path: "/chat/completions",
        method: "POST",
        timeout: 150000,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c.toString("utf8")));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            let detail = raw.slice(0, 300);
            try {
              detail = JSON.parse(raw).error?.message || detail;
            } catch {}
            reject(new Error(`DeepSeek API ${res.statusCode}：${detail}`));
            return;
          }
          let data;
          try {
            data = JSON.parse(raw);
          } catch {
            reject(new Error("DeepSeek 返回的不是合法 JSON"));
            return;
          }
          const text = String(data.choices?.[0]?.message?.content || "").trim();
          if (!text) {
            reject(new Error("DeepSeek 返回了空内容"));
            return;
          }
          const u = data.usage || {};
          resolve({
            text,
            usage: {
              input_tokens: u.prompt_tokens || 0,
              output_tokens: u.completion_tokens || 0,
              cached_input_tokens: u.prompt_cache_hit_tokens || 0,
            },
          });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("DeepSeek API 请求超时")));
    req.on("error", reject);
    req.end(payload);
  });
}

function askModel(prompt, settings) {
  const provider = String(config.provider || "codex").toLowerCase();
  if (provider === "deepseek" || provider === "api") return askDeepSeek(prompt, settings);
  return askCodex(prompt, settings);
}

function addUsage(session, usage) {
  if (!usage) return;
  if (!session.usage) session.usage = { calls: 0, input: 0, cached: 0, output: 0 };
  session.usage.calls += 1;
  session.usage.input += Number(usage.input_tokens) || 0;
  session.usage.cached += Number(usage.cached_input_tokens) || 0;
  session.usage.output += Number(usage.output_tokens) || 0;
}

/* ---------- 提示词 ---------- */

function characterSheet(session) {
  const c = session.character;
  const attrs = ATTRS.map((a) => `${a.label} ${c.attrs[a.key]}`).join("　");
  const skills = SKILLS.map((s) => `${s.name} ${skillValue(c, s.name)}`).join("　");
  return [
    `姓名：${c.name}　称呼：${c.gender || "未定"}　年龄：${c.age || "未定"}`,
    `身份：${c.role || "未定"}`,
    `外貌：${c.appearance || "未描述"}`,
    `性格：${c.personality || "未描述"}`,
    `背景：${c.background || "未描述"}`,
    `目标：${c.goal || "未描述"}`,
    `属性：${attrs}`,
    `技能值：${skills}`,
    `状态：生命 ${session.status.hp}/${session.status.hpMax}　理智 ${session.status.san}/${session.status.sanMax}　钱 ${session.status.money}`,
    `背包：${session.inventory.length ? session.inventory.join("、") : "空"}`,
    `已知线索：${session.clues.length ? session.clues.join("、") : "无"}`,
  ].join("\n");
}

function recentLog(session, limit = 12) {
  return session.log
    .filter((e) => e.type === "player" || e.type === "gm" || e.type === "dice" || e.type === "event")
    .slice(-limit)
    .map((e) => {
      const text = e.text.length > 500 ? `${e.text.slice(0, 500)}…（后略）` : e.text;
      if (e.type === "player") return `玩家：${text}`;
      if (e.type === "gm") return `GM：${text}`;
      if (e.type === "dice") return `【判定】${text}`;
      return `【事件】${text}`;
    })
    .join("\n");
}

function scenarioBrief(scenario) {
  const npcs = (scenario.npcs || [])
    .map((n) => `- ${n.name}：${n.desc}${n.secret ? `（内情：${n.secret}）` : ""}`)
    .join("\n");
  const endings = (scenario.endings || []).map((e) => `- ${e.name}：${e.condition}`).join("\n");
  return [
    `【剧本】${scenario.title}（${scenario.genre}）`,
    `背景：${scenario.background}`,
    `玩家初始处境：${scenario.hook || ""}`,
    `相关人物：\n${npcs}`,
    `线索池（GM 内部参考，只能通过场景与对话逐步放出）：${(scenario.clues || []).join("、")}`,
    `真相（严禁直接说破）：${scenario.truth || ""}`,
    `结局方向：\n${endings}`,
    `基调：${scenario.tone || "紧张、克制、有画面感"}`,
  ].join("\n");
}

function rulesBlock(settings) {
  const s = settings || getSettings();
  const lines = [
    "【你与引擎的分工】",
    "你是这场跑团的 GM（主持人）。玩家的行动结果由外面的引擎掷骰决定，你不得自行编造随机结果。",
    "1) 叙述要紧凑、有画面感，用第二人称称呼玩家，每回合推进一点剧情，不要一次性把整条线讲完。",
    `2) 篇幅要求：${NARRATIVE_LENGTH[s.narrativeLength] || NARRATIVE_LENGTH["标准"]}`,
    "3) 当玩家的行动结果不确定、且失败会有代价时，先把叙述停在需要判定的那一刻，然后在结尾输出判定请求：",
    "<checks>",
    '[{"skill":"侦查","why":"找书房暗格"}]',
    "</checks>",
    "skill 只能从这个列表里选：侦查、聆听、话术、威吓、格斗、潜行、身手、学识、医术、意志。dc 可以不写，引擎按标准难度定。",
    "一次最多提出 2 个判定。明确提出判定后，不要再写结果，也不要写“你成功了/你失败了”。",
    "4) 每回合结尾必须输出状态块（只写有变化的项，没变化就写 advance_minutes）：",
    "<state>",
    '{"advance_minutes": 15, "hp": 0, "san": -2, "money": -50, "clues_add": ["药瓶"], "items_add": ["铜钥匙"], "items_remove": ["蜡烛"], "relations": {"陆守仁": {"attitude": "戒备", "delta": -1, "note": "你当面质疑了他"}}, "objectives_add": ["弄清信是谁寄的"], "objectives_done": ["找到账房先生"], "flags": {"见过管家": true}}',
    "</state>",
    "advance_minutes 按行动实际耗时估计：一句对话 5-10，查看房间一角 10-20，翻找整个房间 30，赶路 30-120，睡一整夜按实际时长。",
    "5) 不要在正文里写出 <checks>、<state> 这些标签之外的内容；两个标签之外就是给玩家看的故事正文。",
    "6) 不要输出 markdown 标题、不要解释规则、不要提到引擎、模型、AI、提示词。",
    "7) 涉及玩家不知道的信息（真相、他人内心）不要写出来，只能通过可见可听的细节暗示。",
    "8) 结尾留一个自然的行动余地或悬念，让玩家决定下一步。",
    "9) 当剧情走到结局，在 state 里加 \"ending\":\"结局名\" 并补一句结局标题，之后停止提出判定。",
    "10) 玩家角色死亡或彻底疯狂时，也要给一个收束的结局，并在 state 里写 \"ending\"。",
    "11) 人物关系：当某个 NPC 对玩家的态度发生明显变化时，在 state 里写 relations，键是人物名，值是 {\"attitude\":\"信任\",\"delta\":1,\"note\":\"原因\"}。",
    "    attitude 用两到四个字的词（初识、戒备、信任、感激、敌意、亲近……），delta 是 -3 到 3 的整数，表示好感的变化方向。",
    "    关系没有变化就不要写 relations；不要每回合都把所有人写一遍。",
    "12) 目标：玩家明确接下或完成一件事时，用 objectives_add / objectives_done（各最多 2 条，每条 20 字以内）。",
  ];
  if (!s.allowCritFail) {
    lines.push("※ 本局关闭了大失败：即使判定掷出最低值，也请给一个“代价很大但没崩盘”的结果，不要写角色摔断腿之类的灾难。");
  }
  lines.push("※ 如果玩家给了参考资料，把它当作既定设定：不要与其中的事实冲突，也不要整段照抄原文。");
  if (s.extraInstructions) {
    lines.push("", "【玩家补充设定（优先级高于默认风格，但不能违反上面格式要求）】", s.extraInstructions);
  }
  return lines.join("\n");
}

function relationsBlock(session) {
  const entries = Object.entries(session.relations || {});
  if (!entries.length) return "";
  const lines = entries
    .sort((a, b) => (b[1].updatedTurn || 0) - (a[1].updatedTurn || 0))
    .map(([name, r]) => {
      const value = Number(r.value) || 0;
      const sign = value > 0 ? `+${value}` : `${value}`;
      return `- ${name}：${r.attitude}（${sign}）${r.note ? ` · ${r.note}` : ""}`;
    });
  return `【人物关系（这是当前状态，请保持前后一致）】\n${lines.join("\n")}`;
}

function objectivesBlock(session) {
  const list = session.objectives || [];
  if (!list.length) return "";
  const lines = list.map((o) => `- ${o.text}${o.done ? "（已完成）" : ""}`);
  return `【玩家的当前目标】\n${lines.join("\n")}`;
}

function eventLogBlock(session) {
  const list = (session.eventLog || []).slice(-8);
  if (!list.length) return "";
  return `【已经发生的事件】\n${list.map((e) => `- ${e.at}　${e.title}${e.note ? `：${e.note}` : ""}`).join("\n")}`;
}

function linksBlock(scenario, settings) {
  const links = [...((settings || {}).links || []), ...((scenario || {}).links || [])];
  const block = linksToPromptBlock(links);
  return block
    ? `【参考资料（玩家提供的外部链接内容，属于既定设定，不要照抄原文）】\n${block}`
    : "";
}

function timeBlock(session, scenario) {
  const up = upcomingEvents(session, scenario).slice(0, 3);
  const fired = session.firedEvents.length ? session.firedEvents.length : 0;
  const upcoming = up.length
    ? up
        .map((e) => {
          const h = Math.floor(e.minute / 60);
          const m = e.minute % 60;
          const when = `第${e.day}天 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          return `${when} — ${e.title}（${humanDuration(e.minutesAway)}）`;
        })
        .join("\n")
    : "（没有待触发的日程）";
  return [
    `【当前游戏时间】${clockText(session.time)}`,
    `【已触发日程数】${fired}`,
    `【后续日程】\n${upcoming}`,
  ].join("\n");
}

const joinBlocks = (...parts) => parts.filter((x) => x && String(x).trim()).join("\n\n");

/** 放在提示词最末尾的格式提醒：越靠近生成位置，模型越不容易忘。 */
const FORMAT_REMINDER = [
  "【输出格式（本轮务必照做）】",
  "1. 先写正文，正文里不要出现任何尖括号标签。",
  "2. 需要玩家掷骰时，正文停在要判定的那一刻，然后写一行：",
  '<checks>[{"skill":"侦查","why":"找暗格"}]</checks>',
  "3. 最后必须写状态块（没有变化也要写，只写 change 的部分）：",
  '<state>{"advance_minutes":10,"relations":{"人物名":{"attitude":"态度词","delta":1,"note":"原因"}},"objectives_add":["新目标"],"objectives_done":["已完成的事"],"clues_add":["新线索"]}</state>',
  "没有变化的键可以省略，但 <state> 标签本身不能省。",
].join("\n");

function buildPrompt(session, scenario, playerAction, settings) {
  return [
    rulesBlock(settings),
    "",
    scenarioBrief(scenario),
    "",
    linksBlock(scenario, settings),
    "",
    "【玩家角色卡】",
    characterSheet(session),
    "",
    timeBlock(session, scenario),
    "",
    joinBlocks(relationsBlock(session), objectivesBlock(session), eventLogBlock(session)),
    "",
    "【最近发生了什么】",
    recentLog(session, 14) || "（游戏刚开始）",
    "",
    `【玩家这一回合的行动】${playerAction}`,
    "",
    FORMAT_REMINDER,
    "",
    "现在按上面的格式给出这一回合的叙述。",
  ].join("\n");
}

function buildContinuePrompt(session, scenario, playerAction, opening, rolls, events, settings) {
  const rollText = rolls
    .map((r) => `${r.skill}：d20 掷出 ${r.roll} ＋ 技能 ${r.skillBonus} ＝ ${r.total}，难度 ${r.dc} → ${r.grade}`)
    .join("\n");
  const eventText = events.length
    ? events.map((e) => `${e.title}：${e.note || ""}`).join("\n")
    : "（无）";
  return [
    rulesBlock(settings),
    "",
    scenarioBrief(scenario),
    "",
    linksBlock(scenario, settings),
    "",
    "【玩家角色卡】",
    characterSheet(session),
    "",
    timeBlock(session, scenario),
    "",
    joinBlocks(relationsBlock(session), objectivesBlock(session), eventLogBlock(session)),
    "",
    "【最近发生了什么】",
    recentLog(session, 10) || "（游戏刚开始）",
    "",
    `【玩家这一回合的行动】${playerAction}`,
    "",
    "【你已经写过的前半段叙述】",
    opening,
    "",
    "【引擎掷出的判定结果（这就是既定事实，请据此叙述）】",
    rollText || "（无需判定）",
    "",
    "【同一时间触发的事件】",
    eventText,
    "",
    "请接着前半段叙述写出结果，不要重复前半段的内容，结尾按格式给出状态块。",
    "这一回合不要再提出新的判定请求。",
    "",
    FORMAT_REMINDER,
  ].join("\n");
}

/* ---------- 解析模型输出 ---------- */

function extractBlock(text, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const m = text.match(re);
  if (!m) return null;
  return { raw: m[0], body: m[1].trim() };
}

function looseJson(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {}
  const objMatch = body.match(/[[{][\s\S]*[\]}]/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {}
  }
  return null;
}

function parseModelTurn(text) {
  const checksBlock = extractBlock(text, "checks");
  const stateBlock = extractBlock(text, "state");
  let checks = looseJson(checksBlock?.body) || [];
  if (!Array.isArray(checks)) checks = checks && typeof checks === "object" ? [checks] : [];
  checks = checks
    .filter((c) => c && typeof c === "object")
    .slice(0, 2)
    .map((c) => ({
      skill: SKILLS.some((s) => s.name === c.skill) ? c.skill : "侦查",
      dc: Number(c.dc) || 15,
      why: String(c.why || "").slice(0, 60),
    }));
  const state = looseJson(stateBlock?.body) || {};
  let narrative = text;
  if (checksBlock) narrative = narrative.replace(checksBlock.raw, "");
  if (stateBlock) narrative = narrative.replace(stateBlock.raw, "");
  narrative = narrative.replace(/\n{3,}/g, "\n\n").trim();
  return { narrative, checks, state, hadState: Boolean(stateBlock) };
}

function applyState(session, scenario, state) {
  const changes = [];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let advanced = false;
  if (Number.isFinite(Number(state.hp)) && Number(state.hp) !== 0) {
    const before = session.status.hp;
    session.status.hp = clamp(session.status.hp + Number(state.hp), 0, session.status.hpMax);
    changes.push(`生命 ${before} → ${session.status.hp}`);
  }
  if (Number.isFinite(Number(state.san)) && Number(state.san) !== 0) {
    const before = session.status.san;
    session.status.san = clamp(session.status.san + Number(state.san), 0, session.status.sanMax);
    changes.push(`理智 ${before} → ${session.status.san}`);
  }
  if (Number.isFinite(Number(state.money)) && Number(state.money) !== 0) {
    session.status.money += Number(state.money);
    changes.push(`钱 ${state.money > 0 ? "+" : ""}${state.money}（现有 ${session.status.money}）`);
  }
  for (const clue of state.clues_add || []) {
    if (clue && !session.clues.includes(clue)) {
      session.clues.push(String(clue));
      changes.push(`获得线索：${clue}`);
    }
  }
  for (const item of state.items_add || []) {
    if (item && !session.inventory.includes(item)) {
      session.inventory.push(String(item));
      changes.push(`获得物品：${item}`);
    }
  }
  for (const item of state.items_remove || []) {
    const i = session.inventory.indexOf(String(item));
    if (i >= 0) {
      session.inventory.splice(i, 1);
      changes.push(`失去物品：${item}`);
    }
  }
  for (const [k, v] of Object.entries(state.flags || {})) {
    session.flags[k] = v;
  }

  // 人物关系：可只改态度，也可用 delta 微调数值
  const rels = state.relations;
  if (rels && typeof rels === "object" && !Array.isArray(rels)) {
    if (!session.relations) session.relations = {};
    for (const [rawName, value] of Object.entries(rels)) {
      const name = String(rawName).trim().slice(0, 30);
      if (!name) continue;
      const prev = session.relations[name] || { value: 0, attitude: "初识", note: "", updatedTurn: 0 };
      const next = { ...prev };
      if (typeof value === "string") {
        next.attitude = value.slice(0, 20);
      } else if (typeof value === "number" && Number.isFinite(value)) {
        next.value = clamp(prev.value + value, -10, 10);
      } else if (value && typeof value === "object") {
        if (Number.isFinite(Number(value.delta))) next.value = clamp(prev.value + Number(value.delta), -10, 10);
        else if (Number.isFinite(Number(value.value))) next.value = clamp(Number(value.value), -10, 10);
        if (value.attitude) next.attitude = String(value.attitude).slice(0, 20);
        if (value.note) next.note = String(value.note).slice(0, 140);
      } else {
        continue;
      }
      next.updatedTurn = session.turns || 0;
      if (prev.attitude !== next.attitude || prev.value !== next.value || prev.note !== next.note) {
        session.relations[name] = next;
        changes.push(
          `人物关系：${name} ${next.attitude}${next.value ? `（${next.value > 0 ? "+" : ""}${next.value}）` : ""}${next.note ? ` · ${next.note}` : ""}`
        );
      }
    }
  }

  // 当前目标
  if (!Array.isArray(session.objectives)) session.objectives = [];
  for (const item of (Array.isArray(state.objectives_add) ? state.objectives_add : []).slice(0, 4)) {
    const text = clip(item, 80);
    if (text && !session.objectives.some((o) => o.text === text)) {
      session.objectives.push({ text, turn: session.turns || 0, done: false });
      changes.push(`新目标：${text}`);
    }
  }
  for (const item of (Array.isArray(state.objectives_done) ? state.objectives_done : []).slice(0, 4)) {
    const text = clip(item, 80);
    if (!text) continue;
    const hit = session.objectives.find((o) => !o.done && (o.text === text || o.text.includes(text) || text.includes(o.text)));
    if (hit) {
      hit.done = true;
      changes.push(`完成目标：${hit.text}`);
    }
  }
  while (session.objectives.length > 10) session.objectives.shift();

  // 人物关系条目上限，防止长局里越记越多（保留最近更新过的 40 个）
  const relKeys = Object.keys(session.relations || {});
  if (relKeys.length > 40) {
    relKeys
      .sort((a, b) => (session.relations[b].updatedTurn || 0) - (session.relations[a].updatedTurn || 0))
      .slice(40)
      .forEach((key) => delete session.relations[key]);
  }

  let fired = [];
  if (Number.isFinite(Number(state.advance_minutes))) {
    fired = advanceTime(session, scenario, Number(state.advance_minutes));
    if (Number(state.advance_minutes) > 0) {
      changes.push(`时间推进 ${state.advance_minutes} 分钟 → ${clockText(session.time)}`);
      advanced = true;
    }
  }
  if (state.ending) {
    session.ended = String(state.ending);
  }
  if (session.status.hp <= 0 && !session.ended) session.ended = "力竭而亡";
  if (session.status.san <= 0 && !session.ended) session.ended = "理智崩塌";
  return { changes, fired, advanced };
}

/* ---------- 回合流程 ---------- */

async function runTurn(session, scenario, playerAction) {
  const segments = [];
  const settings = getSettings();
  const fallbackMinutes = settings.autoAdvanceMinutes;
  session.log.push({ type: "player", text: playerAction });

  const first = await askModel(buildPrompt(session, scenario, playerAction, settings), settings);
  addUsage(session, first.usage);
  const parsed = parseModelTurn(first.text);
  let narrative = parsed.narrative;
  if (narrative) {
    segments.push({ type: "gm", text: narrative });
    session.log.push({ type: "gm", text: narrative });
  }

  let rolls = [];
  let firedEvents = [];

  if (parsed.checks.length) {
    const results = parsed.checks.map((c) => ({ ...rollCheck(session.character, c.skill, c.dc, session.difficulty), why: c.why }));
    rolls = results;
    for (const r of results) {
      const line = `${r.skill}${r.why ? `（${r.why}）` : ""}：d20=${r.roll}＋技能${r.skillBonus}=${r.total}　难度${r.dc}　${r.grade}`;
      segments.push({ type: "dice", text: line, grade: r.grade });
      session.log.push({ type: "dice", text: line });
    }
    // 前半段不推进时间，避免同一个动作被算两次耗时；时间只认结果叙述里的估算。
    const pre = applyState(session, scenario, { ...parsed.state, advance_minutes: 0, ending: undefined });
    firedEvents = pre.fired;
    for (const ev of firedEvents) {
      segments.push({ type: "event", text: `${ev.title}：${ev.note || ""}` });
      session.log.push({ type: "event", text: `${ev.title}：${ev.note || ""}` });
    }
    const second = await askModel(
      buildContinuePrompt(session, scenario, playerAction, narrative, results, firedEvents, settings),
      settings
    );
    addUsage(session, second.usage);
    const parsed2 = parseModelTurn(second.text);
    if (parsed2.narrative) {
      segments.push({ type: "gm", text: parsed2.narrative });
      session.log.push({ type: "gm", text: parsed2.narrative });
    }
    const post = applyState(session, scenario, parsed2.state);
    for (const ev of post.fired) {
      segments.push({ type: "event", text: `${ev.title}：${ev.note || ""}` });
      session.log.push({ type: "event", text: `${ev.title}：${ev.note || ""}` });
    }
    if (!post.advanced) {
      const fallback = applyState(session, scenario, { advance_minutes: fallbackMinutes });
      for (const ev of fallback.fired) {
        segments.push({ type: "event", text: `${ev.title}：${ev.note || ""}` });
        session.log.push({ type: "event", text: `${ev.title}：${ev.note || ""}` });
      }
    }
    for (const ch of [
      ...pre.changes,
      ...post.changes,
      ...(post.advanced || fallbackMinutes <= 0 ? [] : [`时间推进 ${fallbackMinutes} 分钟 → ${clockText(session.time)}`]),
    ]) {
      segments.push({ type: "change", text: ch });
    }
  } else {
    const applied = applyState(session, scenario, parsed.state);
    if (!applied.advanced) {
      const fb = applyState(session, scenario, { advance_minutes: fallbackMinutes });
      applied.fired = applied.fired.concat(fb.fired);
      if (fallbackMinutes > 0) applied.changes.push(`时间推进 ${fallbackMinutes} 分钟 → ${clockText(session.time)}`);
    }
    firedEvents = applied.fired;
    for (const ev of firedEvents) {
      segments.push({ type: "event", text: `${ev.title}：${ev.note || ""}` });
      session.log.push({ type: "event", text: `${ev.title}：${ev.note || ""}` });
    }
    for (const ch of applied.changes) segments.push({ type: "change", text: ch });
  }

  session.turns = (session.turns || 0) + 1;
  session.updatedAt = new Date().toISOString();
  archiveOldLog(session);
  return { segments };
}

async function runOpening(session, scenario) {
  const settings = getSettings();
  const customOpening = String(scenario.opening || "").trim();
  const prompt = [
    rulesBlock(settings),
    "",
    scenarioBrief(scenario),
    "",
    linksBlock(scenario, settings),
    "",
    ...(customOpening
      ? [
          "【玩家写好的开场白（已原样呈现给玩家，不要重复其中的句子）】",
          customOpening,
          "",
        ]
      : []),
    "【玩家角色卡】",
    characterSheet(session),
    "",
    timeBlock(session, scenario),
    "",
    customOpening
      ? "【这是游戏的第一幕】开场白已经给过了，请顺着它往前推一小步：描写此刻正在发生的一件事、一个人的出现或一个细微的变化，把玩家推到一个需要做决定的位置。不要复述开场白。"
      : "【这是游戏的第一幕】请写出开场：把玩家放进场景里，交代他在哪、此刻看到听到什么、眼前最值得注意的东西是什么。3 到 5 段，节奏稳一点，不要急着抛出全部悬念。",
    "结尾按格式给出状态块（如果开局不推进时间，advance_minutes 写 0）。",
  ].join("\n");
  const raw = await askModel(prompt, settings);
  addUsage(session, raw.usage);
  const parsed = parseModelTurn(raw.text);
  if (parsed.narrative) session.log.push({ type: "gm", text: parsed.narrative });
  const applied = applyState(session, scenario, parsed.state);
  return {
    segments: [
      ...(customOpening ? [{ type: "gm", text: customOpening }] : []),
      ...(parsed.narrative ? [{ type: "gm", text: parsed.narrative }] : []),
      ...applied.fired.map((ev) => ({ type: "event", text: `${ev.title}：${ev.note || ""}` })),
      ...applied.changes.map((ch) => ({ type: "change", text: ch })),
    ],
  };
}

/* ---------- 角色创建 ---------- */

function derived(attrs, difficulty, scenario) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const hpMax = 18 + (attrs.con || 5) * 2 + diff.hpShift;
  const sanMax = 18 + (attrs.int || 5) + (attrs.per || 5) + diff.sanShift;
  return { hpMax, sanMax, money: scenario.startMoney ?? 300 };
}

function validateCharacter(character, difficulty) {
  const errors = [];
  if (!character?.name?.trim()) errors.push("角色名字不能为空");
  const attrs = character?.attrs || {};
  let total = 0;
  for (const a of ATTRS) {
    const v = Number(attrs[a.key]);
    if (!Number.isFinite(v) || v < ATTR_MIN || v > ATTR_MAX) {
      errors.push(`${a.label} 需要在 ${ATTR_MIN}-${ATTR_MAX} 之间`);
    }
    total += Number.isFinite(v) ? v : 0;
  }
  if (total > ATTR_POINTS) errors.push(`属性点超出：已用 ${total}/${ATTR_POINTS}`);
  if (total < ATTR_POINTS - 6) errors.push(`还要再分配 ${ATTR_POINTS - total} 点属性`);
  if (!DIFFICULTY[difficulty]) errors.push("难度选项无效");
  return errors;
}

function createSession({ character, scenarioId, difficulty, scenarioDir }) {
  const scenario = loadScenario(scenarioId, scenarioDir);
  if (!scenario) throw new Error("找不到这个剧本");
  const errors = validateCharacter(character, difficulty);
  if (errors.length) throw new Error(errors.join("；"));
  const attrs = {};
  for (const a of ATTRS) attrs[a.key] = Number(character.attrs[a.key]);
  const d2 = derived(attrs, difficulty, scenario);
  const session = {
    scenarioId,
    difficulty,
    character: {
      name: clip(character.name, CLI.characterName),
      gender: clip(character.gender, 20),
      age: clip(character.age, 20),
      role: clip(character.role, 60),
      appearance: clip(character.appearance, CLI.characterField),
      personality: clip(character.personality, CLI.characterField),
      background: clip(character.background, CLI.characterField),
      goal: clip(character.goal, CLI.characterField),
      attrs,
    },
    status: { hp: d2.hpMax, hpMax: d2.hpMax, san: d2.sanMax, sanMax: d2.sanMax, money: d2.money },
    time: { day: scenario.startDay || 1, minute: scenario.startMinute ?? 9 * 60 },
    inventory: [...(scenario.startItems || [])],
    clues: [],
    relations: {},
    objectives: [],
    flags: {},
    firedEvents: [],
    eventLog: [],
    log: [],
    turns: 0,
    usage: { calls: 0, input: 0, cached: 0, output: 0 },
    logTrimmed: 0,
    ended: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return session;
}

/* ---------- 存档 ---------- */

const SAVE_FILE = path.join(WORK, "session.json");

/** 存档加密：设置 DATA_KEY 时启用；云端默认从 DeepSeek 密钥派生。 */
const DATA_KEY = (() => {
  const explicit = String(process.env.DATA_KEY || "").trim();
  if (explicit) return crypto.createHash("sha256").update(explicit).digest();
  if (String(process.env.MODEL_PROVIDER || config.provider).toLowerCase() === "deepseek") {
    const base = String(process.env.SECRET_KEY || process.env.DEEPSEEK_API_KEY || config.apiKey || "");
    if (base) return crypto.createHash("sha256").update(base + "|paotuan-data|v1").digest();
  }
  return null;
})();

function encryptJson(obj) {
  if (!DATA_KEY) return JSON.stringify(obj, null, 2);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", DATA_KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return JSON.stringify({
    __enc: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

function decryptJson(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || obj.__enc !== 1) return obj;
  if (!DATA_KEY) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", DATA_KEY, Buffer.from(obj.iv, "base64"));
    decipher.setAuthTag(Buffer.from(obj.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(obj.data, "base64")), decipher.final()]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    return null;
  }
}

function saveSession(session, file) {
  try {
    fs.writeFileSync(file || SAVE_FILE, encryptJson(session));
  } catch {}
}

function loadSession(file) {
  try {
    return decryptJson(fs.readFileSync(file || SAVE_FILE, "utf8"));
  } catch {
    return null;
  }
}

module.exports = {
  ROOT, WORK, SCENARIO_DIR, PRESET_DIR, USER_SCENARIO_DIR, config, ATTRS, SKILLS, DIFFICULTY, ATTR_POINTS, ATTR_MIN, ATTR_MAX,
  NARRATIVE_LENGTH, DEFAULT_SETTINGS,
  listScenarios, loadScenario, clockText, upcomingEvents, humanDuration,
  advanceTime, applyState, parseModelTurn, buildPrompt, buildContinuePrompt,
  rollCheck, skillValue, runTurn, runOpening, createSession, saveSession, loadSession,
  validateCharacter, sleep,
  getSettings, saveSettings, saveCustomScenario, readScenarioRaw, deleteCustomScenario,
  listPresets, savePreset, loadPreset, deletePreset, archiveOldLog,
  sanitizeLinks, relationsBlock, objectivesBlock, eventLogBlock, linksBlock, joinBlocks,
};
