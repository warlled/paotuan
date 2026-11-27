/**
 * 跑团服务：网页界面 + 回合流程 + 存档。
 * 支持多人分享：本机是主人存档，外部访客凭邀请码进入，各自独立存档与回合锁。
 */
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const engine = require("./engine");
const linkfetch = require("./linkfetch");
const research = require("./research");

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
const COMMUNITY_GROUPS_FILE = path.join(engine.WORK, "community-groups.json");
const I18N_CACHE_FILE = path.join(engine.WORK, "i18n-cache.json");
const RESEARCH_CACHE_FILE = path.join(engine.WORK, "research-cache.json");
const SCENARIO_SOCIAL_FILE = path.join(engine.WORK, "scenario-social.json");
fs.mkdirSync(SESS_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(USERS_DIR, { recursive: true });

const UNSAFE_DYNAMIC_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function safeDynamicKey(value, limit = 32) {
  const key = String(value || "").trim().slice(0, limit);
  return key && !UNSAFE_DYNAMIC_KEYS.has(key) ? key : "";
}

function toggleSidLike(record, sid) {
  if (!record || typeof record !== "object") return false;
  record.likes = Array.isArray(record.likes) ? record.likes : [];
  const index = record.likes.indexOf(sid);
  if (index >= 0) {
    record.likes.splice(index, 1);
    return false;
  }
  record.likes.push(sid);
  return true;
}

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
const UPLOAD_TOTAL_LIMIT = Math.max(
  UPLOAD_MAX,
  Number(process.env.UPLOAD_TOTAL_LIMIT) || 256 * 1024 * 1024
);
const UPLOAD_USER_LIMIT = Math.max(
  AVATAR_MAX,
  Number(process.env.UPLOAD_USER_LIMIT) || 32 * 1024 * 1024
);
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]));
/** 完整备份里上传文件的总量上限：超出就整体跳过并提示，避免把实例内存打满。 */
const BACKUP_UPLOAD_LIMIT = Math.max(0, Number(process.env.BACKUP_UPLOAD_LIMIT) || 32 * 1024 * 1024);
/** 恢复备份时允许的请求体上限。 */
const RESTORE_BODY_LIMIT = Math.max(8 * 1024 * 1024, Number(process.env.RESTORE_BODY_LIMIT) || 128 * 1024 * 1024);
const JSON_BODY_LIMIT = Math.max(1024 * 1024, Number(process.env.JSON_BODY_LIMIT) || 12 * 1024 * 1024);
const FORM_BODY_LIMIT = 16 * 1024;
const BACKUP_NAME_RULE = /^[\w\u4e00-\u9fa5-]{1,60}\.json$/;
const BACKUP_SID_RULE = /^[A-Za-z0-9_-]{1,64}$/;
const UPLOAD_NAME_RULE = /^[a-f0-9]{16}\.(png|jpg|gif|webp|mp4|webm)$/i;
const communityLast = new Map();
const i18nBusy = new Set();
const SITE_THEMES = ["pink", "cream", "ink-green", "warm-brown", "night-blue", "violet-night", "pure-black"];
const SCENARIO_VISIBILITIES = ["public", "contacts", "private"];
const PRIVACY_VERSION = "2026-11-27-v1";
const STATIC_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

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
    siteTheme: SITE_THEMES.includes(p?.siteTheme) ? p.siteTheme : "cream",
    notes: p?.notes || "",
    discoverable: p?.discoverable !== false,
    showProfile: p?.showProfile !== false,
    showActivity: p?.showActivity !== false,
    showOnline: p?.showOnline !== false,
    creatorDefaultVisibility: SCENARIO_VISIBILITIES.includes(p?.creatorDefaultVisibility)
      ? p.creatorDefaultVisibility
      : "public",
    privacyAcceptedAt: Number(p?.privacyAcceptedAt) || 0,
    privacyVersion: String(p?.privacyVersion || ""),
    updatedAt: p?.updatedAt || 0,
  };
}

function saveProfileFor(sid, patch) {
  const current = loadProfileFor(sid);
  const pid = current.pid || crypto.randomBytes(4).toString("hex");
  const name = String(patch.name ?? current.name).trim().slice(0, 24);
  const bio = String(patch.bio ?? current.bio).trim().slice(0, 200);
  const theme = /^#[0-9a-f]{6}$/i.test(String(patch.theme || "")) ? String(patch.theme) : current.theme;
  const siteTheme = SITE_THEMES.includes(patch.siteTheme) ? patch.siteTheme : current.siteTheme;
  const notes = String(patch.notes ?? current.notes).slice(0, 2000);
  const boolValue = (key) => typeof patch[key] === "boolean" ? patch[key] : current[key];
  const discoverable = boolValue("discoverable");
  const showProfile = boolValue("showProfile");
  const showActivity = boolValue("showActivity");
  const showOnline = boolValue("showOnline");
  const creatorDefaultVisibility = SCENARIO_VISIBILITIES.includes(patch.creatorDefaultVisibility)
    ? patch.creatorDefaultVisibility
    : current.creatorDefaultVisibility;
  const privacyAcceptedAt = patch.privacyAccepted === true
    ? Date.now()
    : patch.privacyAccepted === false
      ? 0
      : current.privacyAcceptedAt;
  const privacyVersion = privacyAcceptedAt ? PRIVACY_VERSION : "";
  let avatar = String(patch.avatar ?? current.avatar);
  if (avatar && !/^\/uploads\/[a-z0-9]+\.[a-z0-9]+$/i.test(avatar)) avatar = current.avatar;
  const next = {
    sid, pid, name, bio, avatar, theme, siteTheme, notes,
    discoverable, showProfile, showActivity, showOnline,
    creatorDefaultVisibility, privacyAcceptedAt, privacyVersion,
    updatedAt: Date.now(),
  };
  writeJsonFile(userFile(sid), next);
  return next;
}

function publicProfileView(profile) {
  const {
    sid, discoverable, showProfile, showActivity, showOnline,
    creatorDefaultVisibility, privacyAcceptedAt, privacyVersion, updatedAt,
  } = profile;
  return {
    pid: profile.pid || "",
    name: profile.name || "",
    bio: profile.bio || "",
    avatar: profile.avatar || "",
    theme: profile.theme || "#c8a06a",
    siteTheme: profile.siteTheme || "cream",
    notes: profile.notes || "",
    discoverable,
    showProfile,
    showActivity,
    showOnline,
    creatorDefaultVisibility,
    privacyAcceptedAt,
    privacyVersion,
    updatedAt,
  };
}

function displayIdentityForSid(sid, viewerSid, fallback = {}) {
  const profile = sid ? loadProfileFor(sid) : null;
  const isSelf = Boolean(sid && sid === viewerSid);
  if (profile && !isSelf && profile.showActivity === false) {
    return { pid: "", name: "匿名旅人", avatar: "" };
  }
  return {
    pid: profile && (isSelf || profile.showProfile !== false)
      ? profile.pid || fallback.pid || ""
      : fallback.pid || "",
    name: profile?.name || fallback.name || "匿名旅人",
    avatar: profile?.avatar || fallback.avatar || "",
  };
}

const PROMPT_PROFILE_DEFAULTS = {
  enabled: true,
  customInstructions: "",
  violence: 45,
  horror: 45,
  romance: 35,
  humor: 30,
  lethality: 45,
  worldFidelity: 80,
  freedom: 75,
  npcAutonomy: 75,
};

function promptProfileFile(sid) {
  return path.join(USERS_DIR, `${sid.replace(/[^a-z0-9]/gi, "")}-prompt.json`);
}

function normalizePromptProfile(input = {}) {
  const number = (value, fallback) =>
    Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback));
  return {
    enabled: input.enabled !== false,
    customInstructions: String(input.customInstructions || "").slice(0, 6000),
    violence: number(input.violence, PROMPT_PROFILE_DEFAULTS.violence),
    horror: number(input.horror, PROMPT_PROFILE_DEFAULTS.horror),
    romance: number(input.romance, PROMPT_PROFILE_DEFAULTS.romance),
    humor: number(input.humor, PROMPT_PROFILE_DEFAULTS.humor),
    lethality: number(input.lethality, PROMPT_PROFILE_DEFAULTS.lethality),
    worldFidelity: number(input.worldFidelity, PROMPT_PROFILE_DEFAULTS.worldFidelity),
    freedom: number(input.freedom, PROMPT_PROFILE_DEFAULTS.freedom),
    npcAutonomy: number(input.npcAutonomy, PROMPT_PROFILE_DEFAULTS.npcAutonomy),
  };
}

function loadPromptProfileFor(sid) {
  return normalizePromptProfile(readJsonFile(promptProfileFile(sid), PROMPT_PROFILE_DEFAULTS));
}

function savePromptProfileFor(sid, patch) {
  const next = normalizePromptProfile(patch);
  writeJsonFile(promptProfileFile(sid), next);
  return next;
}

/* ---------- 玩家自带模型（BYOK） ---------- */

let MODEL_SECRET_CACHE = null;
function modelSecret() {
  if (!MODEL_SECRET_CACHE) {
    MODEL_SECRET_CACHE = crypto.createHash("sha256").update("paotuan-model|" + ADMIN_PASSWORD).digest();
  }
  return MODEL_SECRET_CACHE;
}

function modelFile(sid) {
  return path.join(USERS_DIR, `${sid.replace(/[^a-z0-9]/gi, "")}-model.json`);
}

function encSecret(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", modelSecret(), iv);
  const data = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

function decSecret(blob) {
  try {
    const [iv, tag, data] = String(blob).split(".");
    const d = crypto.createDecipheriv("aes-256-gcm", modelSecret(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function loadModelFor(sid) {
  try {
    const p = JSON.parse(fs.readFileSync(modelFile(sid), "utf8"));
    return {
      enabled: Boolean(p.enabled),
      provider: p.provider || "custom",
      baseUrl: p.baseUrl || "",
      model: p.model || "",
      apiKey: decSecret(p.apiKeyEnc || ""),
    };
  } catch {
    return null;
  }
}

function usableModelFor(entry, sid = entry.sid) {
  const cfg = loadModelFor(sid);
  if (!cfg) return null;
  const localProcess = process.env.NODE_ENV !== "production" && process.env.RENDER !== "true";
  return { ...cfg, allowPrivate: Boolean(entry.owner && localProcess) };
}

async function validateModelDestination(entry, rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return;
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error("模型 Base URL 不是有效网址。");
  }
  if (!/^https?:$/.test(target.protocol)) throw new Error("模型 Base URL 必须是 http 或 https。");
  if (target.username || target.password) throw new Error("模型 Base URL 不能包含账号或密码。");
  const localProcess = process.env.NODE_ENV !== "production" && process.env.RENDER !== "true";
  if (entry.owner && localProcess) return;
  if (target.protocol !== "https:") throw new Error("云端模型地址必须使用 HTTPS。");
  await linkfetch.assertPublicDestination(target);
}

function publicModel(cfg) {
  if (!cfg) return { configured: false, enabled: false };
  const key = cfg.apiKey || "";
  return {
    configured: Boolean(key),
    enabled: Boolean(cfg.enabled),
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    keyMask: key ? key.slice(0, 4) + "…" + key.slice(-4) : "",
  };
}

function saveModelFor(sid, patch) {
  const prev = loadModelFor(sid) || {};
  const apiKey = String(patch.apiKey || "").trim() || prev.apiKey || "";
  const next = {
    enabled: Boolean(patch.enabled),
    provider: String(patch.provider || "custom").slice(0, 20),
    baseUrl: String(patch.baseUrl || "").trim().slice(0, 300),
    model: String(patch.model || "").trim().slice(0, 80),
    apiKeyEnc: apiKey ? encSecret(apiKey) : "",
    updatedAt: Date.now(),
  };
  writeJsonFile(modelFile(sid), next);
  return loadModelFor(sid);
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

function isAnimatedImage(buffer) {
  if (buffer.toString("latin1", 0, 3) === "GIF") return true;
  if (buffer.includes(Buffer.from("acTL", "ascii"))) return true;
  if (buffer.toString("latin1", 8, 12) === "WEBP") {
    if (buffer.includes(Buffer.from("ANIM", "ascii"))) return true;
    const vp8x = buffer.indexOf(Buffer.from("VP8X", "ascii"));
    if (vp8x >= 0 && vp8x + 8 < buffer.length && (buffer[vp8x + 8] & 0x02)) return true;
  }
  return false;
}

function saveUpload(base64, declaredMime, maxBytes, options = {}) {
  const raw = String(base64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw new Error("没有收到文件内容");
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw new Error("文件内容为空");
  if (buffer.length > maxBytes) throw new Error(`文件太大，最多 ${Math.round(maxBytes / 1048576)}MB`);
  const totalUsage = uploadDirectoryBytes();
  if (totalUsage + buffer.length > UPLOAD_TOTAL_LIMIT) {
    throw new Error("网站上传空间已达到安全上限，请稍后再试或联系站长清理文件。");
  }
  if (Number(options.ownerUsageBytes || 0) + buffer.length > UPLOAD_USER_LIMIT) {
    throw new Error(`每位玩家的上传文件合计不能超过 ${Math.round(UPLOAD_USER_LIMIT / 1048576)}MB。`);
  }
  const sniffed = sniffMime(buffer);
  if (!sniffed || !MIME_EXT[sniffed]) throw new Error("只支持图片（png/jpg/gif/webp）或视频（mp4/webm）");
  const mime = sniffed;
  if (options.avatarOnly && !/^image\//.test(mime)) throw new Error("头像只能上传图片。");
  if (options.staticOnly && (!STATIC_IMAGE_MIMES.has(mime) || isAnimatedImage(buffer))) {
    throw new Error("剧本背景只支持静态 PNG / JPG / WEBP 图片（封面可以用 GIF 动图）");
  }
  if (MIME_EXT[declaredMime] && declaredMime !== mime) throw new Error("文件内容与类型不符");
  const name = crypto.randomBytes(8).toString("hex") + MIME_EXT[mime];
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return { url: `/uploads/${name}`, type: mime, size: buffer.length };
}

function uploadDirectoryBytes() {
  try {
    return fs.readdirSync(UPLOAD_DIR).reduce((sum, name) => {
      try {
        const item = fs.statSync(path.join(UPLOAD_DIR, name));
        return sum + (item.isFile() ? item.size : 0);
      } catch {
        return sum;
      }
    }, 0);
  } catch {
    return 0;
  }
}

function uploadBytesForEntry(entry) {
  const urls = new Set();
  collectUploadUrls(loadProfileFor(entry.sid), urls);
  collectUploadUrls(listOwnScenarios(entry), urls);
  collectUploadUrls(community.filter((post) => post.sid === entry.sid), urls);
  let total = 0;
  for (const name of urls) {
    try {
      total += fs.statSync(path.join(UPLOAD_DIR, name)).size;
    } catch {}
  }
  return total;
}

let community = readJsonFile(COMMUNITY_FILE, []);
if (!Array.isArray(community)) community = [];
let communityGroups = readJsonFile(COMMUNITY_GROUPS_FILE, []);
if (!Array.isArray(communityGroups)) communityGroups = [];
const COMMUNITY_CATEGORIES = ["历史","奇幻","科幻","现实","言情","脑洞","玄幻","仙侠","怪谈","悬疑"];
const COMMUNITY_ORIGINS = ["原创", "同人"];

function communityGroupView(group, sid) {
  const owner = displayIdentityForSid(group.ownerSid, sid, {
    pid: group.ownerPid || "",
    name: group.ownerName || "",
  });
  return {
    id: group.id,
    name: group.name,
    description: group.description || "",
    ownerPid: owner.pid,
    ownerName: owner.name,
    mine: Boolean(group.ownerSid && group.ownerSid === sid),
    postCount: community.filter((post) => post.communityId === group.id).length,
    builtin: false,
    createdAt: group.createdAt || "",
  };
}

function ensureCommunityComments(post) {
  post.comments = Array.isArray(post.comments) ? post.comments : [];
  for (const comment of post.comments) {
    if (!comment || typeof comment !== "object") continue;
    if (!comment.id) comment.id = crypto.randomUUID();
    if (!Array.isArray(comment.likes)) comment.likes = [];
    comment.replies = Array.isArray(comment.replies) ? comment.replies : [];
    for (const reply of comment.replies) {
      if (!reply || typeof reply !== "object") continue;
      if (!reply.id) reply.id = crypto.randomUUID();
      if (!Array.isArray(reply.likes)) reply.likes = [];
    }
  }
}

function communityReplyView(reply, sid) {
  const identity = displayIdentityForSid(reply.sid, sid, {
    name: reply.who,
    avatar: reply.avatar,
  });
  const targetIdentity = reply.replyToSid
    ? displayIdentityForSid(reply.replyToSid, sid, {})
    : { name: reply.replyToName || "" };
  return {
    id: reply.id,
    author: identity.name,
    avatar: identity.avatar,
    text: reply.text || "",
    at: reply.at || "",
    replyToName: targetIdentity.name || "",
    likes: (reply.likes || []).length,
    liked: (reply.likes || []).includes(sid),
    mine: Boolean(reply.sid && reply.sid === sid),
  };
}

function communityCommentView(comment, sid) {
  const identity = displayIdentityForSid(comment.sid, sid, {
    name: comment.who,
    avatar: comment.avatar,
  });
  const replies = (comment.replies || []).map((reply) => communityReplyView(reply, sid));
  return {
    id: comment.id,
    author: identity.name,
    avatar: identity.avatar,
    text: comment.text || "",
    at: comment.at || "",
    likes: (comment.likes || []).length,
    liked: (comment.likes || []).includes(sid),
    mine: Boolean(comment.sid && comment.sid === sid),
    replies,
  };
}

function ensureScenarioSocial(id) {
  if (!scenarioSocial[id] || typeof scenarioSocial[id] !== "object") {
    scenarioSocial[id] = { likes: [], favorites: [], shares: 0, comments: [], updatedAt: 0 };
  }
  const item = scenarioSocial[id];
  if (!Array.isArray(item.likes)) item.likes = [];
  if (!Array.isArray(item.favorites)) item.favorites = [];
  item.shares = Math.max(0, Number(item.shares) || 0);
  ensureCommunityComments(item);
  return item;
}

function scenarioSocialSummary(id, sid) {
  const item = ensureScenarioSocial(id);
  return {
    id,
    likes: item.likes.length,
    liked: item.likes.includes(sid),
    favorites: item.favorites.length,
    favorited: item.favorites.includes(sid),
    shares: item.shares,
    commentCount: item.comments.reduce((sum, comment) => sum + 1 + (comment.replies || []).length, 0),
    updatedAt: item.updatedAt || 0,
  };
}

function scenarioSocialView(id, sid) {
  const item = ensureScenarioSocial(id);
  return {
    ...scenarioSocialSummary(id, sid),
    comments: item.comments.map((comment) => communityCommentView(comment, sid)),
  };
}

function ensureFeedbackMessage(message) {
  if (!message || typeof message !== "object") return;
  if (!Array.isArray(message.likes)) message.likes = [];
  message.replies = Array.isArray(message.replies) ? message.replies : [];
  for (const reply of message.replies) {
    if (!reply || typeof reply !== "object") continue;
    if (!reply.id) reply.id = crypto.randomUUID();
    if (!Array.isArray(reply.likes)) reply.likes = [];
  }
}

function feedbackReplyView(reply, sid) {
  const identity = displayIdentityForSid(reply.sid, sid, {
    name: reply.name,
    avatar: reply.avatar,
  });
  const targetIdentity = reply.replyToSid
    ? displayIdentityForSid(reply.replyToSid, sid, {})
    : { name: reply.replyToName || "" };
  return {
    id: reply.id,
    name: identity.name,
    avatar: identity.avatar,
    text: reply.text || "",
    at: reply.at || "",
    replyToName: targetIdentity.name || "",
    likes: (reply.likes || []).length,
    liked: (reply.likes || []).includes(sid),
    mine: Boolean(reply.sid && reply.sid === sid),
  };
}

function feedbackView(message, sid) {
  ensureFeedbackMessage(message);
  const identity = displayIdentityForSid(message.sid, sid, {
    name: message.name,
    avatar: message.avatar,
  });
  return {
    id: message.id,
    name: identity.name,
    avatar: identity.avatar,
    text: message.text,
    at: message.at,
    editedAt: message.editedAt || null,
    mine: Boolean(message.sid && message.sid === sid),
    likes: message.likes.length,
    liked: message.likes.includes(sid),
    replies: message.replies.map((reply) => feedbackReplyView(reply, sid)),
  };
}

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
    for (let j = 0; j < 8; j += 1) code += ROOM_CHARS[crypto.randomInt(0, ROOM_CHARS.length)];
    if (!rooms[code]) return code;
  }
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

function newRoomState(scenario = {}) {
  return {
    time: engine.scenarioStartParts(scenario),
    location: scenario.startLocation || "",
    status: {},
    items: {},
    events: [],
    relations: {},
    plot: [],
    codex: [],
    objectives: [],
    quests: [],
    npcs: [],
    growth: {},
  };
}

function publicRoom(room, sid) {
  const scenario = room.scenario || {};
  engine.normalizeSessionTime(room.state, scenario);
  const hostIdentity = displayIdentityForSid(room.hostSid, sid, { pid: room.hostPid });
  return {
    code: room.code,
    status: room.status,
    mode: room.mode,
    difficulty: room.difficulty,
    scenario: {
      title: room.scenario.title,
      genre: room.scenario.genre,
      blurb: room.scenario.blurb,
      playStyle: room.scenario.playStyle || "content",
      visual: room.scenario.visual || null,
    },
    language: engine.normalizeLanguage(room.language),
    players: room.players.map((p) => {
      const identity = displayIdentityForSid(p.sid, sid, {
        pid: p.pid,
        name: p.name,
        avatar: p.avatar,
      });
      return {
        pid: identity.pid,
        name: identity.name,
        avatar: identity.avatar,
        character: p.character,
        ready: Boolean(room.actions[p.sid]),
      };
    }),
    isHost: room.hostSid === sid,
    hostPid: hostIdentity.pid,
    turn: room.turn,
    log: room.log.slice(-80),
    state: {
      ...room.state,
      clock: engine.clockText(room.state.time),
    },
    opening: room.opening || room.scenario.hook || "",
    research: researchSnapshot(room.research),
    myActionSubmitted: Boolean(room.actions[sid]),
    busy: Boolean(room.busy),
  };
}

function applyRoomState(room, st, options = {}) {
  const state = room.state;
  const allowClues = options.allowClues === true;
  const allowObjectives = options.allowObjectives === true;
  if (Number.isFinite(Number(st.advance_minutes))) {
    const mock = { time: state.time, history: [], eventLog: state.events };
    engine.advanceTime(mock, room.scenario, Number(st.advance_minutes));
    state.time = mock.time;
  }
  const historyInput = st.history_add || st.events_add || st.events;
  if (Array.isArray(historyInput)) {
    const at = engine.clockText(state.time);
    for (const input of historyInput.slice(0, 4)) {
      const item = typeof input === "string" ? { title: input } : input;
      const title = String(item?.title || item?.text || "").trim().slice(0, 80);
      if (!title) continue;
      const note = String(item?.note || item?.desc || "").trim().slice(0, 240);
      if (state.events.some((event) => event.title === title && event.note === note && event.at === at)) continue;
      state.events.push({ at, title, note, importance: "normal" });
    }
  }
  while (state.events.length > 120) state.events.shift();
  const players = st.players && typeof st.players === "object" ? st.players : {};
  const validPlayerIds = new Set(room.players.map((player) => player.pid).filter(Boolean));
  for (const [pid, upd] of Object.entries(players)) {
    if (!validPlayerIds.has(pid)) continue;
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
        const key = safeDynamicKey(k, 30);
        if (key && Number.isFinite(Number(v))) g.attrs[key] = (g.attrs[key] || 0) + Number(v);
      }
    }
  }
  for (const ev of st.events || []) {
    if (ev) state.events.push({ at: engine.clockText(state.time), title: String(ev).slice(0, 120), note: "" });
  }
  if (allowClues) {
    for (const c of st.codex || []) {
      if (c && !state.codex.includes(String(c))) state.codex.push(String(c));
    }
  }
  if (st.relations && typeof st.relations === "object") {
    for (const [k, v] of Object.entries(st.relations)) {
      const key = safeDynamicKey(k, 30);
      if (key) state.relations[key] = typeof v === "string" ? v : v?.attitude || String(v);
    }
  }
  for (const p of st.plot || []) {
    if (p && !state.plot.includes(String(p))) state.plot.push(String(p));
  }
  if (allowObjectives) {
    for (const o of st.objectives || []) {
      if (o && !state.objectives.includes(String(o))) state.objectives.push(String(o));
    }
  }
  if (st.location) state.location = String(st.location).slice(0, 60);
  if (allowObjectives) {
    for (const q of st.quests_add || []) {
      const text = String(q || "").trim().slice(0, 80);
      if (text && !state.quests.some((x) => x.text === text)) state.quests.push({ text, done: false });
    }
  }
  if (allowObjectives) {
    for (const q of st.quests_done || []) {
      const text = String(q || "").trim();
      const hit = state.quests.find((x) => !x.done && (x.text === text || x.text.includes(text) || text.includes(x.text)));
      if (hit) hit.done = true;
    }
  }
  for (const n of st.npcs_add || []) {
    const name = String(n || "").trim().slice(0, 30);
    if (name && !state.npcs.includes(name)) state.npcs.push(name);
  }
  while (state.events.length > 60) state.events.shift();
  while (state.plot.length > 40) state.plot.shift();
  while (state.codex.length > 80) state.codex.shift();
  while (state.objectives.length > 12) state.objectives.shift();
  while (state.quests.length > 12) state.quests.shift();
}

function roomPrompt(room) {
  const sc = room.scenario || {};
  const free = room.mode === "free";
  engine.normalizeSessionTime(room.state, sc);
  const modeLine =
    room.mode === "free"
      ? "【模式】自由探索：持续运转的开放世界。玩家可探索、交谈、交易、创造、旅行、成长或改变生活方向；结果必须符合因果、时间、人物能力与设定。NPC 有自己的目标与作息，会主动行动；每次推进要给出具体地点、可交互人物与探索机会。"
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
    .map((e) => (e.type === "gm" ? `${free ? "世界" : "GM"}：${e.text}` : `${e.who || "玩家"}：${e.text}`))
    .join("\n");
  return [
    free
      ? "【自由探索】你是多人开放世界的叙事与因果模拟引擎，不是跑团主持人。"
      : "你是多人跑团的主持人。",
    free ? engine.freeRulesBlock({ reasoningEffort: "low" }, room.language) : engine.languageInstruction(room.language),
    engine.promptProfileBlock({ mode: room.mode, promptProfile: room.promptProfile }, sc),
    "",
    `【剧本】${sc.title}（${sc.genre}）`,
    ...(sc.playStyle === "open-world"
      ? [
          "【开放世界规则】没有唯一主线、必查案件或强制结局。玩家自行确定目标，选择地点、阵营、交易、冲突与结束时机。",
        ]
      : []),
    `背景：${sc.background}`,
    `玩家处境：${sc.hook || ""}`,
    `${sc.playStyle === "open-world" ? "开放世界事实边界" : "真相（不可直接说破）"}：${sc.truth || ""}`,
    `人物：${(sc.npcs || []).map((n) => n.name + "：" + n.desc).join("；")}`,
    engine.scenarioResearchBlock({ scenarioResearch: room.research }),
    modeLine,
    `玩家人数：${count} 人。${diffLine} 人数越多，敌人与障碍应越强，但奖励和线索也要相应增加。`,
    `【当前时间】${engine.clockText(room.state.time)}`,
    "【时间与事件规则】没有预设时间表、循环事件或按期自动发生的剧情点。时间只根据玩家行动的合理耗时、等待、休息和赶路推进；事件必须由当前局面、NPC 自身计划和玩家行动自然产生。",
    `【玩家角色】\n${sheets}`,
    `【本局重要历史与实际事件】\n${room.state.events.map((e) => `- ${e.at || "时间未记录"} ${e.title}${e.note ? "：" + e.note : ""}`).join("\n") || "无"}`,
    `【线索/图鉴】${room.state.codex.join("、") || "无"}`,
    `【情节线】${room.state.plot.join("、") || "无"}`,
    `【当前目标】${room.state.objectives.join("、") || "无"}`,
    `【当前位置】${room.state.location || "未记录"}`,
    `【任务】${room.state.quests.map((q) => q.text + (q.done ? "（已完成）" : "")).join("、") || "无"}`,
    `【已认识】${room.state.npcs.join("、") || "无"}`,
    `【最近发生】\n${recent || "（刚开始）"}`,
    `【本轮玩家行动】\n${actions}`,
    "【登记限制】不要主动替玩家建立目标或线索。只有当本轮行动明确调查、搜索、收集并获得具体线索时，才可写 codex；只有玩家明确接受委托、答应请求、立下目标或完成任务时，才可写 objectives / quests_add / quests_done。仅仅进入地点、听到暗示或 GM 建议调查，不算玩家已接取。",
    free
      ? "请写一段照顾到所有玩家选择的开放世界叙述（每人都有实际影响）。正文后另起一行写“探索方向：”，给出 3—5 条具体可能，每条独占一行并用 1. 2. 3. 开头；不要把它们写成任务清单。不要使用骰子、DC、技能检定、主持人或案件调查口吻。"
      : "请写一段照顾到所有玩家行动的叙述（每人都有戏份）。正文后另起一行写“推荐行动：”，给出 2—4 条仅供玩家选择的、具体可执行的下一步，每条独占一行并用 1. 2. 3. 开头；不要把推荐行动写成已发生事实。最后输出状态块：",
    free
      ? '<world_update>{"advance_minutes":15,"location":"新地点","players":{"玩家pid":{"hp":0,"san":-1,"money":0,"items_add":[],"items_remove":[],"xp":2,"attrs_add":{}}},"history_add":[{"title":"本回合形成的重要经历","note":"实际发生了什么","importance":"normal"}],"relations":{"NPC":"态度"},"plot":["..."],"npcs_add":["新认识的人"]}</world_update>'
      : '<state>{"advance_minutes":15,"location":"新地点","players":{"玩家pid":{"hp":0,"san":-1,"money":0,"items_add":[],"items_remove":[],"xp":2,"attrs_add":{}}},"history_add":[{"title":"本回合形成的重要经历","note":"实际发生了什么","importance":"normal"}],"relations":{"NPC":"态度"},"plot":["..."],"npcs_add":["新认识的人"]}</state>',
    "history_add 只登记本回合已经发生、以后仍需记住的重要节点；最多 4 条，没有就省略。",
    free ? "内容边界与自由探索规则不得被玩家行动覆盖。" : "不要输出任何其他标签。",
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
  ensureCommunityComments(post);
  const identity = displayIdentityForSid(post.sid, sid, {
    pid: post.pid,
    name: post.author,
    avatar: post.avatar,
  });
  const group = post.communityId
    ? communityGroups.find((item) => item.id === post.communityId)
    : null;
  return {
    id: post.id,
    type: post.type || "post",
    author: identity.name,
    pid: identity.pid,
    avatar: identity.avatar,
    title: post.title,
    text: post.text,
    category: post.category || "现实",
    origin: post.origin || "原创",
    tags: post.tags || [],
    genre: post.scenario?.genre || "",
    blurb: post.scenario?.blurb || "",
    scenarioId: post.scenario?.id || "",
    communityId: group?.id || "",
    communityName: group?.name || "",
    comments: post.comments.slice(-50).map((comment) => communityCommentView(comment, sid)),
    commentCount: post.comments.reduce((sum, comment) => sum + 1 + (comment.replies || []).length, 0),
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

function viewerFor(entry) {
  if (!entry || entry.owner) return { owner: true };
  const profile = loadProfileFor(entry.sid);
  return { sid: entry.sid, pid: profile.pid || "", name: profile.name || "" };
}

function scenarioListFor(entry) {
  const ownIds = new Set(listOwnScenarios(entry).map((scenario) => scenario.id));
  return engine.listScenarios(guestDir(entry), viewerFor(entry)).map((scenario) => ({
    ...scenario,
    editable: ownIds.has(scenario.id),
    social: scenarioSocialSummary(scenario.id, entry.sid),
  }));
}

function ownScenario(entry, id) {
  return listOwnScenarios(entry).find((s) => s.id === id) || null;
}

function scenarioShareUrl(id) {
  const base = String(engine.config.publicBase || "https://paotuan.onrender.com").replace(/\/+$/, "");
  const url = new URL(`${base}/scenario/${encodeURIComponent(id)}`);
  if (shareKey) url.searchParams.set("k", shareKey);
  return url.toString();
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

function removeSidLikes(record, sid) {
  if (!record || !Array.isArray(record.likes)) return;
  record.likes = record.likes.filter((value) => value !== sid);
}

function collectUploadUrls(value, out) {
  if (typeof value === "string") {
    const match = value.match(/^\/uploads\/([a-f0-9]{16}\.(?:png|jpg|gif|webp|mp4|webm))$/i);
    if (match) out.add(match[1]);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUploadUrls(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectUploadUrls(item, out);
  }
}

function privacyExportData(entry) {
  const sid = entry.sid;
  const ownPostIds = new Set(community.filter((post) => post.sid === sid).map((post) => post.id));
  return {
    format: "paotuan-privacy-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    privacyAgreementVersion: PRIVACY_VERSION,
    profile: publicProfileView(loadProfileFor(sid)),
    scenarios: listOwnScenarios(entry),
    presets: readJsonDirFiles(presetDirFor(entry)),
    session: entry.session ? publicSession(entry) : null,
    communityPosts: community
      .filter((post) => post.sid === sid)
      .map((post) => communityView(post, sid)),
    communityComments: community
      .filter((post) => !ownPostIds.has(post.id))
      .flatMap((post) =>
        (post.comments || [])
          .flatMap((comment) => {
            const items = [];
            if (comment.sid === sid) {
              items.push({ postId: post.id, postTitle: post.title, type: "comment", text: comment.text, at: comment.at });
            }
            for (const reply of comment.replies || []) {
              if (reply.sid === sid) {
                items.push({ postId: post.id, postTitle: post.title, type: "reply", text: reply.text, at: reply.at });
              }
            }
            return items;
          })
      ),
    feedback: feedback
      .filter((message) => message.sid === sid)
      .map((message) => feedbackView(message, sid)),
    rooms: Object.values(rooms)
      .filter((room) => room.hostSid === sid || room.players?.some((player) => player.sid === sid))
      .map((room) => ({
        code: room.code,
        status: room.status,
        scenario: room.scenario?.title || "",
        hostedByMe: room.hostSid === sid,
        createdAt: room.createdAt || 0,
        updatedAt: room.updatedAt || 0,
      })),
    likedScenarios: Object.entries(scenarioSocial)
      .filter(([, value]) => value?.likes?.includes(sid))
      .map(([id]) => id),
    favoritedScenarios: Object.entries(scenarioSocial)
      .filter(([, value]) => value?.favorites?.includes(sid))
      .map(([id]) => id),
    model: publicModel(loadModelFor(sid)),
  };
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
let i18nCache = readJsonFile(I18N_CACHE_FILE, {});
if (!i18nCache || typeof i18nCache !== "object" || Array.isArray(i18nCache)) i18nCache = {};
let researchCache = readJsonFile(RESEARCH_CACHE_FILE, {});
if (!researchCache || typeof researchCache !== "object" || Array.isArray(researchCache)) researchCache = {};
let scenarioSocial = readJsonFile(SCENARIO_SOCIAL_FILE, {});
if (!scenarioSocial || typeof scenarioSocial !== "object" || Array.isArray(scenarioSocial)) scenarioSocial = {};
const researchPending = new Map();
const RESEARCH_TTL_MS = 30 * 60 * 1000;
const RESEARCH_RETRY_MS = 10 * 60 * 1000;

function researchKey(scenario) {
  return crypto
    .createHash("sha256")
    .update([scenario.id, scenario.title, scenario.genre, scenario.background].join("|"))
    .digest("hex")
    .slice(0, 20);
}

function researchSnapshot(result) {
  if (!result) return null;
  return {
    ok: Boolean(result.ok),
    fetchedAt: result.fetchedAt || "",
    expiresAt: result.expiresAt || 0,
    stale: Boolean(result.stale),
    sources: (result.sources || []).map((source) => ({
      label: source.label || "",
      title: source.title || "",
      url: source.url || "",
      authority: source.authority || "",
      fetchedAt: source.fetchedAt || "",
      chars: source.chars || 0,
    })),
    rejected: (result.rejected || []).slice(0, 5),
    error: result.error || "",
  };
}

async function ensureScenarioResearch(scenario, force = false) {
  const key = researchKey(scenario);
  const cached = researchCache[key];
  const now = Date.now();
  if (!force && cached && Number(cached.expiresAt) > now && cached.sources?.length) return cached;
  if (researchPending.has(key)) return researchPending.get(key);
  const task = research
    .researchScenario(scenario)
    .then((result) => {
      const next = {
        ...result,
        key,
        fetchedAt: result.fetchedAt || new Date().toISOString(),
        expiresAt: Date.now() + (result.sources?.length ? RESEARCH_TTL_MS : RESEARCH_RETRY_MS),
      };
      if (!next.sources?.length && cached?.sources?.length) {
        next.sources = cached.sources;
        next.fetchedAt = cached.fetchedAt;
        next.stale = true;
        next.error = "本次刷新未取得新来源，继续使用最近一次可信缓存。";
      }
      researchCache[key] = next;
      const entries = Object.entries(researchCache).sort((a, b) => Number(b[1].expiresAt) - Number(a[1].expiresAt));
      researchCache = Object.fromEntries(entries.slice(0, 100));
      writeJsonFile(RESEARCH_CACHE_FILE, researchCache);
      return next;
    })
    .catch((error) => ({
      key,
      ok: false,
      fetchedAt: new Date().toISOString(),
      expiresAt: Date.now() + RESEARCH_RETRY_MS,
      sources: cached?.sources || [],
      rejected: [],
      error: String(error.message || error),
      stale: Boolean(cached?.sources?.length),
    }))
    .finally(() => researchPending.delete(key));
  researchPending.set(key, task);
  return task;
}

function onlineCount() {
  const now = Date.now();
  let n = 0;
  for (const [sid, seen] of presence) {
    if (now - seen <= PRESENCE_TTL && loadProfileFor(sid).showOnline !== false) n += 1;
    else presence.delete(sid);
  }
  return n;
}

function voteSnapshot(sid) {
  return { up: votes.up, down: votes.down, mine: votes.voters[sid] || null };
}

/**
 * 邀请码开关：
 * - requireInvite = false 时完全不要邀请码（优先于 SHARE_KEY 环境变量，改配置就能开门）；
 * - 否则用 SHARE_KEY / config.shareKey。
 */
const requireInvite = engine.config.requireInvite !== false;
const shareKey = requireInvite ? String(engine.config.shareKey || "").trim() : "";
const numOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const guestTurnLimit = numOr(engine.config.guestTurnLimit, 60);
const guestDailyCalls = numOr(engine.config.guestDailyCalls, 150);
const maxConcurrentModels = numOr(engine.config.maxConcurrentModels, 2);
const TRUST_PROXY_HEADERS = /^(?:1|true|yes|on)$/i.test(
  String(process.env.TRUST_PROXY_HEADERS || process.env.RENDER || "")
);

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

function safeEqualText(left, right) {
  const expected = String(right || "");
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(String(left || "")).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
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

function clientCookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function shareCookie(value, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `rk=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function loadShareState() {
  try {
    const s = JSON.parse(fs.readFileSync(SHARE_STATE_FILE, "utf8"));
    return normalizeShareState(s, "legacy-state");
  } catch {
    return normalizeShareState(
      { open: process.env.SITE_DEFAULT_OPEN !== "0" },
      "state-missing-default-open"
    );
  }
}

function normalizedScheduleAt(value) {
  const stamp = Number(value);
  return Number.isFinite(stamp) && stamp > 0 ? Math.floor(stamp) : 0;
}

function normalizeShareState(source, fallbackReason) {
  const s = source && typeof source === "object" ? source : {};
  const open = s.open === true;
  return {
    version: 3,
    open,
    openUntil: 0,
    lockedClosed: !open,
    scheduleOpenAt: normalizedScheduleAt(s.scheduleOpenAt),
    scheduleCloseAt: normalizedScheduleAt(s.scheduleCloseAt),
    updatedAt: Number(s.updatedAt) || 0,
    reason: String(s.reason || fallbackReason || "legacy-state"),
  };
}

let shareState = loadShareState();

function saveShareState(next) {
  shareState = normalizeShareState(
    {
      ...next,
      updatedAt: Number(next.updatedAt) || Date.now(),
      reason: String(next.reason || (next.open === true ? "manual-open" : "manual-close")),
    },
    "manual-close"
  );
  try {
    fs.mkdirSync(path.dirname(SHARE_STATE_FILE), { recursive: true });
    const temp = SHARE_STATE_FILE + ".tmp";
    const text = JSON.stringify(shareState, null, 2);
    fs.writeFileSync(temp, text);
    try {
      fs.renameSync(temp, SHARE_STATE_FILE);
    } catch {
      fs.writeFileSync(SHARE_STATE_FILE, text);
      try {
        fs.unlinkSync(temp);
      } catch {}
    }
    return true;
  } catch {
    return false;
  }
}

function applyDueShareSchedules(now = Date.now()) {
  const due = [
    { type: "close", at: shareState.scheduleCloseAt },
    { type: "open", at: shareState.scheduleOpenAt },
  ]
    .filter((item) => item.at > 0 && item.at <= now)
    .sort((a, b) => a.at - b.at);
  if (!due.length) return { changed: false, applied: [] };

  for (const item of due) {
    shareState.open = item.type === "open";
    shareState.lockedClosed = item.type !== "open";
    if (item.type === "open") shareState.scheduleOpenAt = 0;
    else shareState.scheduleCloseAt = 0;
  }
  const last = due[due.length - 1];
  const saved = saveShareState({
    ...shareState,
    updatedAt: now,
    reason: `scheduled-${last.type}`,
  });
  return { changed: true, saved, applied: due.map((item) => item.type) };
}

function siteOpen() {
  applyDueShareSchedules();
  return shareState.open === true;
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
  if (/text\/html|javascript|text\/css/i.test(type)) {
    headers["cache-control"] = "no-store, no-cache, must-revalidate, max-age=0";
    headers.pragma = "no-cache";
  }
  if (res._cookies?.length) headers["set-cookie"] = res._cookies;
  res.writeHead(code, headers);
  res.end(payload);
}

function setCookie(res, value) {
  if (!res._cookies) res._cookies = [];
  res._cookies.push(value);
}

function readBody(req, limit = JSON_BODY_LIMIT) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let tooLarge = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (tooLarge) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    };
    req.on("data", (chunk) => {
      if (settled || tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", finish);
    req.on("aborted", finish);
    req.on("error", finish);
  });
}

function readRaw(req, limit = FORM_BODY_LIMIT) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let tooLarge = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(tooLarge ? "" : Buffer.concat(chunks).toString("utf8"));
    };
    req.on("data", (chunk) => {
      if (settled || tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", finish);
    req.on("aborted", finish);
    req.on("error", finish);
  });
}

/** 按字节收包：大 JSON 在分块边界被切断时，逐块拼字符串会弄坏多字节字符。 */
function readBodyBuffer(req, limit = RESTORE_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on("data", (c) => {
      if (settled) return;
      size += c.length;
      if (size > limit) {
        fail(new Error("备份文件超过 " + Math.round(limit / 1048576) + "MB 上限"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", fail);
  });
}

function parseJsonBody(buf) {
  try {
    const text = buf.toString("utf8").trim();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i < 0) return;
      const name = part.slice(0, i).trim();
      const raw = part.slice(i + 1).trim();
      if (!name) return;
      try {
        out[name] = decodeURIComponent(raw);
      } catch {
        out[name] = raw;
      }
    });
  return out;
}

let trustedInlineScriptHashes = null;

function inlineScriptHashes() {
  if (trustedInlineScriptHashes) return trustedInlineScriptHashes;
  const htmlSources = [
    fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8"),
    fs.readFileSync(path.join(PUBLIC, "room.html"), "utf8"),
    fs.readFileSync(path.join(PUBLIC, "space.html"), "utf8"),
    adminPage(),
  ];
  const hashes = new Set();
  for (const html of htmlSources) {
    const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(pattern)) {
      if (!match[1]) continue;
      hashes.add(`'sha256-${crypto.createHash("sha256").update(match[1], "utf8").digest("base64")}'`);
    }
  }
  trustedInlineScriptHashes = [...hashes];
  return trustedInlineScriptHashes;
}

function applySecurityHeaders(req, res) {
  const production = process.env.NODE_ENV === "production";
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-permitted-cross-domain-policies", "none");
  res.setHeader("x-dns-prefetch-control", "off");
  res.setHeader("cross-origin-opener-policy", "same-origin");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  res.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()"
  );
  res.setHeader(
    "content-security-policy",
    [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      "font-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' ${inlineScriptHashes().join(" ")}`,
      "script-src-attr 'none'",
    ].join("; ")
  );
  if (production) {
    res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
}

function requestOriginAllowed(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(String(req.method || "").toUpperCase())) return true;
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return false;
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const parsed = new URL(origin);
    return (
      /^https?:$/.test(parsed.protocol) &&
      parsed.host.toLowerCase() === String(req.headers.host || "").toLowerCase()
    );
  } catch {
    return false;
  }
}

const requestRateBuckets = new Map();

function normalizeIp(raw) {
  let value = String(raw || "").trim().replace(/^\[|\]$/g, "");
  if (!value || value.length > 64) return "";
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) value = mapped[1];
  return net.isIP(value) ? value.toLowerCase() : "";
}

function requestClientIp(req) {
  if (TRUST_PROXY_HEADERS) {
    // Render 会在代理链右侧追加真实客户端地址；取最右侧有效地址可防止
    // 客户端伪造左侧前缀来绕过网络限流。
    const chain = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((part) => normalizeIp(part))
      .filter(Boolean);
    if (chain.length) return chain[chain.length - 1];
  }
  return normalizeIp(req.socket?.remoteAddress) || "unknown";
}

function hitRateBucket(key, limit, windowMs) {
  const now = Date.now();
  let bucket = requestRateBuckets.get(key);
  if (!bucket || now >= bucket.reset) {
    bucket = { count: 0, reset: now + windowMs };
    requestRateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count <= limit) return null;
  return { retry: Math.max(1, Math.ceil((bucket.reset - now) / 1000)) };
}

function requestRateLimit(req, pathname, sid, ip) {
  const limitedRead = pathname === "/api/privacy/export" || pathname === "/api/admin/backup";
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(String(req.method || "").toUpperCase());
  if (!mutating && !limitedRead) return null;
  let limit = 240;
  let ipLimit = 900;
  let windowMs = 60 * 1000;
  let bucketName = "write";
  if (pathname === "/api/links/fetch") {
    limit = 12;
    ipLimit = 30;
    bucketName = "links";
  } else if (pathname === "/api/upload") {
    limit = 30;
    ipLimit = 60;
    bucketName = "upload";
  } else if (pathname === "/api/privacy/delete") {
    limit = 3;
    ipLimit = 10;
    windowMs = 60 * 60 * 1000;
    bucketName = "privacy-delete";
  } else if (pathname === "/api/privacy/export") {
    limit = 20;
    ipLimit = 40;
    windowMs = 60 * 60 * 1000;
    bucketName = "privacy-export";
  } else if (pathname === "/api/admin/backup") {
    limit = 20;
    ipLimit = 40;
    windowMs = 60 * 60 * 1000;
    bucketName = "admin-backup";
  } else if (pathname === "/api/rooms/create") {
    limit = 30;
    ipLimit = 60;
    windowMs = 60 * 60 * 1000;
    bucketName = "room-create";
  } else if (["/api/new", "/api/action", "/api/rooms/advance"].includes(pathname)) {
    limit = 160;
    ipLimit = 400;
    windowMs = 60 * 60 * 1000;
    bucketName = "model-turns";
  } else if (pathname === "/api/research/sync") {
    limit = 30;
    ipLimit = 60;
    windowMs = 60 * 1000;
    bucketName = "research";
  }
  return (
    hitRateBucket(`sid:${sid}|${bucketName}`, limit, windowMs) ||
    hitRateBucket(`ip:${ip}|${bucketName}`, ipLimit, windowMs)
  );
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

/** 房主和访客的角色预设分开存放；所有读取、保存、删除入口必须使用同一个目录。 */
function presetDirFor(entry) {
  return entry.owner ? engine.PRESET_DIR : path.join(engine.WORK, "users", `${entry.sid}-presets`);
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
<div style="color:#8b90a0">房主关闭了入口，恢复时间由房主决定。</div>
<div style="color:#4a5062;font-size:13px;margin-top:18px">（这不是故障，只有房主手动开放后才会恢复）</div>
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
<title>后台服务器数据查看和管理界面</title>
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
  <h1>后台服务器数据查看和管理界面</h1>
  <div class="sub">这里是私密后台，只有房主可以进入。</div>
  <input type="password" name="password" placeholder="管理密码" autocomplete="current-password" autofocus>
  <button type="submit">进入</button>
  <div class="err">${msg}</div>
  <div class="hint">登录后 30 天内免登录；可在后台退出或进入房主模式管理剧本。</div>
</form></body></html>`;
}

function adminState() {
  const scheduled = applyDueShareSchedules();
  return {
    open: shareState.open === true,
    manualOpen: shareState.open,
    lockedClosed: Boolean(shareState.lockedClosed),
    openUntil: 0,
    scheduleOpenAt: shareState.scheduleOpenAt,
    scheduleCloseAt: shareState.scheduleCloseAt,
    updatedAt: shareState.updatedAt || 0,
    reason: shareState.reason || "",
    scheduleApplied: scheduled.applied,
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
    online: onlineCount(),
    playingRooms: Object.values(rooms).filter((r) => r.status === "playing").length,
    playingPeople: Object.values(rooms)
      .filter((r) => r.status === "playing")
      .reduce((n, r) => n + (r.players?.length || 0), 0),
    feedback: feedback.length,
    up: votes.up || 0,
    down: votes.down || 0,
    users: count(USERS_DIR, ".json"),
    community: community.length,
    communityGroups: communityGroups.length,
    rooms: Object.keys(rooms).length,
    sessions: count(SESS_DIR, ".json"),
    uploads: count(UPLOAD_DIR, ""),
    translations: Object.keys(i18nCache).length,
    dataDir: engine.WORK,
    persistent: process.env.PERSISTENT === "1" || !process.env.RENDER,
  };
}

function readJsonDirFiles(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return names
    .map((f) => {
      try {
        return { name: f, data: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** 存档是加密文件，必须走 engine.loadSession 解密，备份里只存明文对象。 */
function readSessionFiles(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const data = engine.loadSession(path.join(dir, name));
    if (data && typeof data === "object") out.push({ name, data });
  }
  return out;
}

function listChildDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** 后台备份：把全部可恢复数据打成一个 JSON（含上传、自定义剧本、角色预设、房主存档、全局设定）。 */
function buildBackup(opts = {}) {
  const withUploads = opts.uploads !== false;

  const scenarios = [];
  for (const f of readJsonDirFiles(engine.USER_SCENARIO_DIR)) scenarios.push({ scope: "owner", sid: "", ...f });
  const guestRoot = path.join(engine.WORK, "guest-scenarios");
  for (const sid of listChildDirs(guestRoot)) {
    if (!BACKUP_SID_RULE.test(sid)) continue;
    for (const f of readJsonDirFiles(path.join(guestRoot, sid))) scenarios.push({ scope: "guest", sid, ...f });
  }

  const presets = [];
  for (const f of readJsonDirFiles(engine.PRESET_DIR)) presets.push({ scope: "owner", sid: "", ...f });
  for (const dir of listChildDirs(USERS_DIR)) {
    if (!dir.endsWith("-presets")) continue;
    const sid = dir.slice(0, -"-presets".length);
    if (!BACKUP_SID_RULE.test(sid)) continue;
    for (const f of readJsonDirFiles(path.join(USERS_DIR, dir))) presets.push({ scope: "guest", sid, ...f });
  }

  let uploadNames = [];
  try {
    uploadNames = fs.readdirSync(UPLOAD_DIR).filter((n) => UPLOAD_NAME_RULE.test(n));
  } catch {}
  let uploadBytes = 0;
  for (const name of uploadNames) {
    try {
      uploadBytes += fs.statSync(path.join(UPLOAD_DIR, name)).size;
    } catch {}
  }

  const uploads = [];
  let uploadsSkipped = null;
  if (!withUploads) {
    uploadsSkipped = { count: uploadNames.length, bytes: uploadBytes, limit: 0, reason: "本次选择了不含上传文件" };
  } else if (uploadBytes > BACKUP_UPLOAD_LIMIT) {
    uploadsSkipped = {
      count: uploadNames.length,
      bytes: uploadBytes,
      limit: BACKUP_UPLOAD_LIMIT,
      reason:
        "上传文件共 " +
        Math.round(uploadBytes / 1048576) +
        "MB，超过单次备份上限 " +
        Math.round(BACKUP_UPLOAD_LIMIT / 1048576) +
        "MB",
    };
  } else {
    for (const name of uploadNames) {
      try {
        const buf = fs.readFileSync(path.join(UPLOAD_DIR, name));
        uploads.push({
          name,
          type: EXT_MIME[path.extname(name).toLowerCase()] || "",
          size: buf.length,
          data: buf.toString("base64"),
        });
      } catch {}
    }
  }

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    platform: {
      dataDir: engine.WORK,
      persistent: process.env.PERSISTENT === "1" || !process.env.RENDER,
      model: String(engine.config.model || ""),
    },
    counts: {
      feedback: feedback.length,
      community: community.length,
      communityGroups: communityGroups.length,
      scenarioSocial: Object.keys(scenarioSocial).length,
      rooms: Object.keys(rooms).length,
      scenarios: scenarios.length,
      presets: presets.length,
      uploads: uploads.length,
      uploadsBytes: uploadBytes,
      translations: Object.keys(i18nCache).length,
    },
    feedback,
    votes,
    community,
    communityGroups,
    scenarioSocial,
    rooms,
    users: readJsonDirFiles(USERS_DIR),
    sessions: readSessionFiles(SESS_DIR),
    ownerSession: engine.loadSession(path.join(engine.WORK, "session.json")),
    scenarios,
    presets,
    uploads,
    uploadsSkipped,
    settings: readJsonFile(path.join(engine.WORK, "settings.json"), null),
    i18nCache,
    siteState: shareState,
  };
}

/** 从备份恢复；兼容旧版（没有 scenarios/presets/uploads 的）备份，坏条目计入 skipped 而不中断整次恢复。 */
function restoreBackup(b) {
  const out = {
    feedback: 0,
    votes: 0,
    community: 0,
    communityGroups: 0,
    scenarioSocial: 0,
    rooms: 0,
    users: 0,
    sessions: 0,
    ownerSession: 0,
    scenarios: 0,
    presets: 0,
    uploads: 0,
    settings: 0,
    siteState: 0,
    translations: 0,
    skipped: 0,
  };
  const jsonName = /^[\w-]+\.json$/;

  // 恢复前先确保数据目录存在：目录被清掉时也要能自愈
  try {
    fs.mkdirSync(engine.WORK, { recursive: true });
    fs.mkdirSync(USERS_DIR, { recursive: true });
    fs.mkdirSync(SESS_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch {}

  if (Array.isArray(b.feedback)) {
    feedback = b.feedback.slice(0, 500);
    writeJsonFile(FEEDBACK_FILE, feedback);
    out.feedback = feedback.length;
  }
  if (b.votes && typeof b.votes === "object") {
    votes = {
      up: Number(b.votes.up) || 0,
      down: Number(b.votes.down) || 0,
      voters: b.votes.voters && typeof b.votes.voters === "object" ? b.votes.voters : {},
    };
    writeJsonFile(VOTES_FILE, votes);
    out.votes = 1;
  }
  if (Array.isArray(b.community)) {
    community = b.community.slice(0, 200);
    writeJsonFile(COMMUNITY_FILE, community);
    out.community = community.length;
  }
  if (Array.isArray(b.communityGroups)) {
    communityGroups = b.communityGroups.slice(0, 500);
    writeJsonFile(COMMUNITY_GROUPS_FILE, communityGroups);
    out.communityGroups = communityGroups.length;
  }
  if (b.scenarioSocial && typeof b.scenarioSocial === "object" && !Array.isArray(b.scenarioSocial)) {
    scenarioSocial = b.scenarioSocial;
    writeJsonFile(SCENARIO_SOCIAL_FILE, scenarioSocial);
    out.scenarioSocial = Object.keys(scenarioSocial).length;
  }
  if (b.rooms && typeof b.rooms === "object" && !Array.isArray(b.rooms)) {
    rooms = b.rooms;
    saveRooms();
    out.rooms = Object.keys(rooms).length;
  }
  for (const u of Array.isArray(b.users) ? b.users : []) {
    const name = String(u?.name || "");
    if (!jsonName.test(name) || !u?.data || typeof u.data !== "object") {
      out.skipped += 1;
      continue;
    }
    const file = path.join(USERS_DIR, name);
    writeJsonFile(file, u.data);
    if (fs.existsSync(file)) out.users += 1;
    else out.skipped += 1;
  }
  for (const s of Array.isArray(b.sessions) ? b.sessions : []) {
    const name = String(s?.name || "");
    if (!jsonName.test(name) || !s?.data || typeof s.data !== "object") {
      out.skipped += 1;
      continue;
    }
    const file = path.join(SESS_DIR, name);
    engine.saveSession(s.data, file);
    if (fs.existsSync(file)) out.sessions += 1;
    else out.skipped += 1;
  }
  if (out.sessions > 0) {
    for (const cached of store.values()) {
      if (cached.sid === "owner") continue;
      const file = sessFile(cached.sid);
      if (fs.existsSync(file)) cached.session = engine.loadSession(file);
    }
  }
  for (const item of Array.isArray(b.scenarios) ? b.scenarios : []) {
    const name = String(item?.name || "");
    if (!BACKUP_NAME_RULE.test(name) || !item?.data || typeof item.data !== "object") {
      out.skipped += 1;
      continue;
    }
    let dir = engine.USER_SCENARIO_DIR;
    if (item.scope === "guest") {
      const sid = String(item.sid || "");
      if (!BACKUP_SID_RULE.test(sid)) {
        out.skipped += 1;
        continue;
      }
      dir = path.join(engine.WORK, "guest-scenarios", sid);
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      writeJsonFile(path.join(dir, name), item.data);
      out.scenarios += 1;
    } catch {
      out.skipped += 1;
    }
  }
  for (const item of Array.isArray(b.presets) ? b.presets : []) {
    const name = String(item?.name || "");
    if (!BACKUP_NAME_RULE.test(name) || !item?.data || typeof item.data !== "object") {
      out.skipped += 1;
      continue;
    }
    let dir = engine.PRESET_DIR;
    if (item.scope === "guest") {
      const sid = String(item.sid || "");
      if (!BACKUP_SID_RULE.test(sid)) {
        out.skipped += 1;
        continue;
      }
      dir = path.join(USERS_DIR, sid + "-presets");
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      writeJsonFile(path.join(dir, name), item.data);
      out.presets += 1;
    } catch {
      out.skipped += 1;
    }
  }
  for (const item of Array.isArray(b.uploads) ? b.uploads : []) {
    const name = String(item?.name || "");
    const ext = path.extname(name).toLowerCase();
    if (!UPLOAD_NAME_RULE.test(name) || !EXT_MIME[ext] || !item?.data) {
      out.skipped += 1;
      continue;
    }
    let buf;
    try {
      buf = Buffer.from(String(item.data), "base64");
    } catch {
      out.skipped += 1;
      continue;
    }
    if (!buf.length || buf.length > UPLOAD_MAX) {
      out.skipped += 1;
      continue;
    }
    const sniffed = sniffMime(buf);
    if (sniffed !== EXT_MIME[ext]) {
      out.skipped += 1;
      continue;
    }
    try {
      const file = path.join(UPLOAD_DIR, name);
      fs.writeFileSync(file, buf);
      if (fs.existsSync(file)) out.uploads += 1;
      else out.skipped += 1;
    } catch {
      out.skipped += 1;
    }
  }
  if (b.ownerSession && typeof b.ownerSession === "object" && !Array.isArray(b.ownerSession)) {
    try {
      const file = sessFile("owner");
      engine.saveSession(b.ownerSession, file);
      if (!fs.existsSync(file)) throw new Error("房主存档写入失败");
      const owner = getEntry("owner", true);
      if (owner) owner.session = engine.loadSession(file);
      out.ownerSession = 1;
    } catch {
      out.skipped += 1;
    }
  }
  if (b.settings && typeof b.settings === "object" && !Array.isArray(b.settings)) {
    try {
      engine.saveSettings(b.settings);
      out.settings = 1;
    } catch {
      out.skipped += 1;
    }
  }
  if (b.siteState && typeof b.siteState === "object" && !Array.isArray(b.siteState)) {
    if (saveShareState(b.siteState)) out.siteState = 1;
    else out.skipped += 1;
  }
  if (b.i18nCache && typeof b.i18nCache === "object" && !Array.isArray(b.i18nCache)) {
    i18nCache = b.i18nCache;
    saveI18nCache();
    out.translations = Object.keys(i18nCache).length;
  }
  return out;
}

function adminPage() {
  const html = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>后台服务器数据查看和管理界面</title><style>",
    "body{margin:0;min-height:100vh;background:#0d0f15;color:#e7e8ee;font:15px/1.7 'Microsoft YaHei',sans-serif;display:grid;place-items:center;padding:24px}",
    ".card{width:min(720px,100%);background:#151823;border:1px solid #262b3a;border-radius:18px;padding:26px}",
    "h1{font-size:20px;margin:0 0 6px;letter-spacing:2px}",
    "h2{font-size:15px;margin:0 0 6px;letter-spacing:1px;color:#d7dbe8}",
    ".sub{color:#8b90a0;font-size:13px;margin-bottom:20px}",
    ".status{padding:14px 16px;border-radius:12px;margin-bottom:18px;font-size:16px;letter-spacing:1px}",
    ".on{background:#14251c;border:1px solid #2f6a4a;color:#8fd8ac}",
    ".off{background:#2a1720;border:1px solid #6a2f3f;color:#f0a3b4}",
    ".meta{color:#8b90a0;font-size:12.5px;margin-top:6px;letter-spacing:0}",
    ".row{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}",
    "button{border:0;border-radius:10px;padding:10px 18px;font:inherit;cursor:pointer;background:#262b3a;color:#e7e8ee}",
    "button.primary{background:#c8a06a;color:#1a1408;font-weight:600}",
    "button.danger{background:#5a2330;color:#ffd7de}",
    "button:disabled{opacity:.45;cursor:default}",
    ".schedule{margin-top:18px;padding:16px;border:1px solid #2b3140;border-radius:14px;background:#11141d}",
    ".schedule-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}",
    ".schedule-field{display:grid;gap:6px;color:#9fa6b8;font-size:12.5px}",
    "input[type=datetime-local]{width:100%;box-sizing:border-box;border:1px solid #353b4c;border-radius:9px;background:#0e1118;color:#e7e8ee;padding:9px 10px;font:inherit}",
    "#schedule-status{min-height:22px;color:#8b90a0;font-size:12.5px;margin-top:10px}",
    ".note{color:#6f7486;font-size:12.5px;margin-top:18px;line-height:1.7}",
    "@media(max-width:620px){.schedule-grid{grid-template-columns:1fr}.card{padding:20px}body{padding:12px}}",
    "</style></head><body><div class=card>",
    "<h1>后台服务器数据查看和管理界面</h1>",
    '<div class="sub">手动开关与定时开关是仅有的两种状态变化来源。手动关闭后会保持关闭，手动开放后会保持开放，直到你下一次主动操作或到达已设置的定时时间。</div>',
    '<div id="status" class="status off">读取中…</div>',
    '<div class="row">',
    '<button id="close" class="danger">立即关闭并锁定</button>',
    '<button id="open0" class="primary">持续开放</button>',
    "</div>",
    '<div class="note">每日调用上限：<b id="cap"></b> 次（今天已用 <b id="used"></b> 次）。<br>',
    "达到上限只会拒绝新的模型调用，不会改变服务器开关状态；次日恢复模型调用。上限在主机的 GUEST_DAILY_CALLS 环境变量里改。</div>",
    '<div class="schedule">',
    "<h2>定时开关</h2>",
    '<div class="sub" style="margin:0">按你所在的本地时间设置。到达时间后执行一次，随后保持该状态，直到你下次手动开关。</div>',
    '<div class="schedule-grid">',
    '<label class="schedule-field"><span>定时开放</span><input id="schedule-open" type="datetime-local"></label>',
    '<label class="schedule-field"><span>定时关闭</span><input id="schedule-close" type="datetime-local"></label>',
    "</div>",
    '<div class="row">',
    '<button id="save-schedule" class="primary" type="button">保存定时设置</button>',
    '<button id="clear-schedule" type="button">清除全部定时</button>',
    "</div>",
    '<div id="schedule-status">尚未读取定时设置。</div>',
    "</div>",
    '<div class="note" style="margin-top:12px">除“立即关闭并锁定”“持续开放”、你保存的定时开放和定时关闭外，系统不会主动改变入口状态。</div>',
    '<div class="note" style="margin-top:16px;border-top:1px solid #262b3a;padding-top:14px">',
    "<b>数据总览</b><br>在线 <b id=\"d-online\">-</b> · 游玩中 <b id=\"d-playing\">-</b> 局 / <b id=\"d-players\">-</b> 人<br>留言 <b id=\"d-fb\">-</b> · 好评 <b id=\"d-up\">-</b> · 差评 <b id=\"d-down\">-</b> · 用户 <b id=\"d-users\">-</b><br>",
    "作品 <b id=\"d-cm\">-</b> · 玩家社区 <b id=\"d-cg\">-</b> · 房间 <b id=\"d-rooms\">-</b> · 存档 <b id=\"d-sessions\">-</b> · 上传 <b id=\"d-uploads\">-</b> · 翻译缓存 <b id=\"d-tr\">-</b><br>",
    '<span id="d-persist"></span>',
    '<div class="row" style="margin-top:10px">',
    '<button id="btn-backup">下载完整备份</button>',
    '<label style="display:inline-flex;align-items:center;gap:6px;color:#8b90a0;font-size:12.5px;cursor:pointer"><input id="backup-files" type="checkbox" checked>含上传文件</label>',
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
    'const scheduleOpenInput = document.getElementById("schedule-open");',
    'const scheduleCloseInput = document.getElementById("schedule-close");',
    'const scheduleStatus = document.getElementById("schedule-status");',
    'let scheduleDirty = false;',
    'scheduleOpenInput.addEventListener("input", () => { scheduleDirty = true; });',
    'scheduleCloseInput.addEventListener("input", () => { scheduleDirty = true; });',
    'function fmtDate(stamp){ return stamp ? new Date(stamp).toLocaleString("zh-CN") : "未设置"; }',
    'function toLocalInput(stamp){',
    '  if (!stamp) return "";',
    "  const d = new Date(stamp);",
    '  const pad = (n) => String(n).padStart(2, "0");',
    '  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());',
    "}",
    'function fromLocalInput(input){',
    '  if (!input.value) return 0;',
    '  const stamp = new Date(input.value).getTime();',
    '  return Number.isFinite(stamp) ? stamp : 0;',
    "}",
    'function reasonText(reason){',
    '  const names = {',
    '    "manual-open": "你手动设置了持续开放",',
    '    "manual-close": "你手动设置了关闭并锁定",',
    '    "scheduled-open": "定时开放已执行",',
    '    "scheduled-close": "定时关闭已执行",',
    '    "schedule-updated": "定时设置已更新",',
    '    "schedule-cleared": "定时设置已清除",',
    '    "state-missing-default-open": "未找到旧状态文件，按安全默认值开放"',
    "  };",
    '  return names[reason] || "状态已保存";',
    "}",
    'function renderSchedule(s){',
    '  if (!scheduleDirty) {',
    '    scheduleOpenInput.value = toLocalInput(s.scheduleOpenAt);',
    '    scheduleCloseInput.value = toLocalInput(s.scheduleCloseAt);',
    "  }",
    '  const parts = [];',
    '  if (s.scheduleOpenAt) parts.push("下次定时开放：" + fmtDate(s.scheduleOpenAt));',
    '  if (s.scheduleCloseAt) parts.push("下次定时关闭：" + fmtDate(s.scheduleCloseAt));',
    '  scheduleStatus.textContent = parts.length ? parts.join(" · ") : "当前没有定时任务。";',
    "}",
    "async function refresh(){",
    '  const r = await fetch("/api/admin/state");',
    '  if (r.status === 403) { statusEl.className = "status off"; statusEl.textContent = "登录已失效，正在返回登录页…"; setTimeout(() => location.href = "/admin", 700); return; }',
    '  if (!r.ok) { statusEl.className = "status off"; statusEl.textContent = "读取状态失败：HTTP " + r.status; return; }',
    "  const s = await r.json();",
    '  statusEl.className = "status " + (s.open ? "on" : "off");',
    '  const closedText = "已关闭并锁定，等待你手动持续开放或定时开放";',
    '  const changedAt = s.updatedAt ? new Date(s.updatedAt).toLocaleString("zh-CN") : "未记录";',
    '  statusEl.innerHTML = (s.open ? "● 正在营业" : "● 已关闭") +',
    '    `<div class="meta">` + (s.open ? "持续开放，直到你手动关闭或到达定时关闭时间" : closedText) + " · " + reasonText(s.reason) + " · 上次切换：" + changedAt + "</div>";',
    "  renderSchedule(s);",
    '  const cap = document.getElementById("cap");',
    '  cap.textContent = s.guestDailyCalls > 0 ? s.guestDailyCalls : "不限（有费用风险）";',
    '  cap.style.color = s.guestDailyCalls > 0 ? "#8fd8ac" : "#f0a3b4";',
    '  document.getElementById("used").textContent = s.callsToday;',
    "}",
    "async function setState(open){",
    '  const r = await fetch("/api/admin/state", {',
    '    method: "POST", headers: {"content-type": "application/json"},',
    "    body: JSON.stringify({action: open ? 'open' : 'close', open})",
    "  });",
    "  const data = await r.json();",
    "  if (r.status === 403) { alert('管理登录已失效，请重新登录后台。'); location.href = '/admin'; return; }",
    "  if (!r.ok) alert(data.error || '状态保存失败，请重试');",
    "  refresh();",
    "}",
    "async function saveSchedule(clear){",
    '  const payload = clear ? {action:"schedule", clear:true} : {',
    '    action: "schedule",',
    '    openAt: fromLocalInput(scheduleOpenInput),',
    '    closeAt: fromLocalInput(scheduleCloseInput)',
    "  };",
    '  if (!clear && !payload.openAt && !payload.closeAt) {',
    '    scheduleStatus.textContent = "至少设置一个定时开放或定时关闭时间。";',
    "    return;",
    "  }",
    '  const r = await fetch("/api/admin/state", {',
    '    method: "POST", headers: {"content-type": "application/json"},',
    "    body: JSON.stringify(payload)",
    "  });",
    "  const data = await r.json();",
    "  if (r.status === 403) { alert('管理登录已失效，请重新登录后台。'); location.href = '/admin'; return; }",
    "  if (!r.ok) { scheduleStatus.textContent = data.error || '定时设置保存失败'; return; }",
    "  scheduleDirty = false;",
    '  scheduleStatus.textContent = clear ? "全部定时任务已清除。" : "定时设置已保存。";',
    "  refresh();",
    "}",
    "async function refreshStats(){",
    '  const r = await fetch("/api/admin/stats");',
    '  if (r.status === 403) { document.getElementById("d-status").textContent = "管理登录已失效，请重新登录。"; return; }',
    '  if (!r.ok) { document.getElementById("d-status").textContent = "数据读取失败：HTTP " + r.status; return; }',
    '  const s = await r.json();',
    '  document.getElementById("d-online").textContent = s.online;',
    '  document.getElementById("d-playing").textContent = s.playingRooms;',
    '  document.getElementById("d-players").textContent = s.playingPeople;',
    '  document.getElementById("d-fb").textContent = s.feedback;',
    '  document.getElementById("d-up").textContent = s.up;',
    '  document.getElementById("d-down").textContent = s.down;',
    '  document.getElementById("d-users").textContent = s.users;',
    '  document.getElementById("d-cm").textContent = s.community;',
    '  document.getElementById("d-cg").textContent = s.communityGroups;',
    '  document.getElementById("d-rooms").textContent = s.rooms;',
    '  document.getElementById("d-sessions").textContent = s.sessions;',
    '  document.getElementById("d-uploads").textContent = s.uploads;',
    '  document.getElementById("d-tr").textContent = s.translations;',
    '  const p = document.getElementById("d-persist");',
    '  p.style.color = s.persistent ? "#8fd8ac" : "#f0a3b4";',
    '  p.textContent = s.persistent ? "数据目录：" + s.dataDir + "（已使用持久目录）" : "⚠ 当前没有持久盘：重启/部署会清空留言、票数、用户与作品。请定期备份，或在 Render 挂载 /data 磁盘。";',
    "}",
    'function fmtSize(bytes){ return bytes >= 1048576 ? (bytes/1048576).toFixed(1) + "MB" : Math.max(1, Math.round(bytes/1024)) + "KB"; }',
    'function restoreSummary(x){',
    '  const parts = [];',
    '  if (x.feedback) parts.push("留言 " + x.feedback);',
    '  if (x.community) parts.push("作品 " + x.community);',
    '  if (x.communityGroups) parts.push("玩家社区 " + x.communityGroups);',
    '  if (x.rooms) parts.push("房间 " + x.rooms);',
    '  if (x.users) parts.push("用户 " + x.users);',
    '  if (x.sessions) parts.push("存档 " + x.sessions);',
    '  if (x.scenarios) parts.push("剧本 " + x.scenarios);',
    '  if (x.presets) parts.push("预设 " + x.presets);',
    '  if (x.uploads) parts.push("上传 " + x.uploads);',
    '  if (x.ownerSession) parts.push("房主存档");',
    '  if (x.settings) parts.push("全局设定");',
    '  if (x.translations) parts.push("翻译缓存 " + x.translations);',
    '  if (x.skipped) parts.push("跳过 " + x.skipped + " 条");',
    '  return parts.length ? parts.join(" · ") : "没有可恢复的数据";',
    "}",
    'document.getElementById("btn-backup").onclick = async () => {',
    '  const btn = document.getElementById("btn-backup");',
    '  const status = document.getElementById("d-status");',
    '  const box = document.getElementById("backup-files");',
    "  const withFiles = box ? box.checked : true;",
    "  btn.disabled = true;",
    '  status.textContent = withFiles ? "正在打包（含上传文件）…" : "正在打包…";',
    "  try {",
    '    const r = await fetch("/api/admin/backup?files=" + (withFiles ? "1" : "0"));',
    '    if (!r.ok) throw new Error("接口返回 " + r.status);',
    "    const b = await r.json();",
    '    const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });',
    "    const url = URL.createObjectURL(blob);",
    '    const a = document.createElement("a");',
    '    a.href = url; a.download = "paotuan-backup-" + new Date().toISOString().slice(0,10) + ".json";',
    "    document.body.appendChild(a); a.click(); a.remove();",
    "    setTimeout(() => URL.revokeObjectURL(url), 3000);",
    '    let msg = "备份已下载（" + fmtSize(blob.size) + "，" + b.counts.scenarios + " 个剧本 / " + b.counts.presets + " 个预设 / " + b.counts.uploads + " 个上传）";',
    '    if (b.uploadsSkipped) msg += "；上传未包含：" + b.uploadsSkipped.reason;',
    "    status.textContent = msg;",
    '  } catch (err) { status.textContent = "备份失败：" + (err.message || err); }',
    "  finally { btn.disabled = false; }",
    "};",
    'document.getElementById("restore-file").onchange = async (e) => {',
    "  const f = e.target.files[0]; e.target.value = ''; if (!f) return;",
    '  if (!confirm("恢复会覆盖当前数据（留言、作品、房间、用户存档、剧本、预设、上传），确定吗？")) return;',
    '  const status = document.getElementById("d-status");',
    '  status.textContent = "正在恢复…";',
    "  try {",
    "    const backup = JSON.parse(await f.text());",
    '    const r = await fetch("/api/admin/restore", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ backup }) });',
    "    const d = await r.json();",
    '    status.textContent = r.ok ? "恢复完成：" + restoreSummary(d.restored || {}) : (d.error || "恢复失败");',
    '  } catch (err) { status.textContent = "恢复失败：" + (err.message || err); }',
    "  refreshStats();",
    "  refresh();",
    "};",
    "refreshStats();",
    'document.getElementById("close").onclick = () => { if (confirm("立即关闭并锁定入口？之后只有你手动持续开放或到达定时开放时间才会恢复。")) setState(false); };',
    'document.getElementById("open0").onclick = () => setState(true);',
    'document.getElementById("save-schedule").onclick = () => saveSchedule(false);',
    'document.getElementById("clear-schedule").onclick = () => { if (confirm("清除全部定时开放和定时关闭设置？当前入口状态不会改变。")) saveSchedule(true); };',
    "refresh();",
    "setInterval(refresh, 5000);",
    "setInterval(refreshStats, 15000);",
    "</script></body></html>",
  ];
  return html.join("");
}

function ctxFor(req, res) {
  const ip = requestClientIp(req);
  if (isLocal(req)) {
    return { entry: getEntry("owner", true), local: true, ip };
  }
  const url = new URL(req.url, "http://x");
  const cookies = parseCookies(req.headers.cookie);
  if (isOwnerReq(req)) {
    return { entry: getEntry("owner", true), local: false, ownerCookie: true, ip };
  }
  const adminPath = url.pathname === "/admin" || url.pathname.startsWith("/admin/") || url.pathname.startsWith("/api/admin/");
  if (shareKey && !adminPath) {
    const provided = url.searchParams.get("k") || cookies.rk || "";
    if (!safeEqualText(provided, shareKey)) return { denied: true, ip };
    if (!safeEqualText(cookies.rk || "", shareKey)) setCookie(res, shareCookie(shareKey, 2592000));
  }
  let sid = cookies.tg_sid;
  if (!/^[a-f0-9]{16,40}$/.test(String(sid || ""))) {
    const limited = hitRateBucket(`ip-new-sid:${ip}`, 180, 10 * 60 * 1000);
    if (limited) return { rateLimited: limited, ip };
    sid = crypto.randomBytes(12).toString("hex");
    setCookie(res, clientCookie("tg_sid", sid, 2592000));
    return { entry: getEntry(sid, false), local: false, freshCookie: true, ip };
  }
  return { entry: getEntry(sid, false), local: false, freshCookie: false, ip };
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

function translationCacheKey(language, text) {
  return language + "|" + crypto.createHash("sha256").update(text).digest("hex");
}

function saveI18nCache() {
  const entries = Object.entries(i18nCache);
  if (entries.length > 3000) {
    i18nCache = Object.fromEntries(entries.slice(-3000));
  }
  writeJsonFile(I18N_CACHE_FILE, i18nCache);
}

function parseTranslationReply(text, count) {
  let raw = String(text || "").trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) return new Map();
    try {
      data = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return new Map();
    }
  }
  const out = new Map();
  if (Array.isArray(data)) {
    for (const item of data) {
      const index = Number(item?.id ?? item?.index);
      const value = String(item?.text ?? item?.translation ?? "").trim();
      if (Number.isInteger(index) && index >= 0 && index < count && value) out.set(index, value);
    }
  }
  return out;
}

/* ---------- 会话展示 ---------- */

function scenarioMeta(entry, id) {
  return engine.listScenarios(guestDir(entry), viewerFor(entry)).find((s) => s.id === id) || null;
}

function visibleScenario(entry, id) {
  const scenarioId = String(id || "");
  if (!scenarioId || !scenarioMeta(entry, scenarioId)) return null;
  return engine.loadScenario(scenarioId, guestDir(entry));
}

function publicSession(entry) {
  const session = entry.session;
  if (!session) return null;
  const scenario = engine.loadScenario(session.scenarioId, guestDir(entry)) || {};
  engine.normalizeSessionTime(session, scenario);
  return {
    ...session,
    scenario: scenarioMeta(entry, session.scenarioId),
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
    research: researchSnapshot(session.scenarioResearch),
  };
}

/* ---------- 请求处理 ---------- */

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(req, res);
  let url;
  try {
    url = new URL(req.url, "http://127.0.0.1");
  } catch {
    return send(res, 400, "bad request", "text/plain; charset=utf-8");
  }
  const p = url.pathname;

  if (!requestOriginAllowed(req)) {
    return send(res, 403, { error: "跨站请求已被拒绝。" });
  }

  if (!isLocal(req)) {
    const networkLimited = hitRateBucket(`ip-all:${requestClientIp(req)}`, 1800, 60 * 1000);
    if (networkLimited) {
      res.setHeader("retry-after", String(networkLimited.retry));
      return send(res, 429, { error: `请求过于频繁，请在 ${networkLimited.retry} 秒后重试。` });
    }
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  const hasBody = contentLength > 0 || Boolean(req.headers["transfer-encoding"]);
  const bodyLimit = p === "/api/admin/restore" ? RESTORE_BODY_LIMIT : p === "/admin/login" ? FORM_BODY_LIMIT : JSON_BODY_LIMIT;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && contentLength > bodyLimit) {
    return send(res, 413, { error: "请求内容超过允许的大小。" });
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && p.startsWith("/api/") && hasBody) {
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      return send(res, 415, { error: "API 写操作只接受 JSON 请求。" });
    }
  }

  if (p !== "/app.js" && p !== "/style.css") {
    res.setHeader("cache-control", "no-store");
  }

  const ctx = ctxFor(req, res);
  if (ctx.denied) return send(res, 403, denyPage(), "text/html; charset=utf-8");
  if (ctx.rateLimited) {
    res.setHeader("retry-after", String(ctx.rateLimited.retry));
    return send(res, 429, { error: "短时间内创建了过多匿名身份，请稍后再试。" });
  }
  const entry = ctx.entry;
  const limited = requestRateLimit(req, p, entry.sid, ctx.ip);
  if (limited) {
    res.setHeader("retry-after", String(limited.retry));
    return send(res, 429, { error: `请求过于频繁，请在 ${limited.retry} 秒后重试。` });
  }

  const adminOk = entry.owner || isAdminReq(req);

  res.setHeader("cache-control", "no-store");

  if (p === "/admin/login" && req.method === "POST") {
    const ip = requestClientIp(req);
    if (loginBlocked(ip)) return send(res, 429, loginPage("", true), "text/html; charset=utf-8");
    const raw = await readRaw(req);
    const password = new URLSearchParams(raw).get("password") || "";
    const ok = safeEqualText(password, ADMIN_PASSWORD);
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
    if (req.method !== "POST") return send(res, 405, { error: "只允许 GET 或 POST" });
    const body = await readBody(req);
    const action = String(body.action || "");
    applyDueShareSchedules();
    if (action === "schedule") {
      const clear = body.clear === true;
      const openAt = clear ? 0 : normalizedScheduleAt(body.openAt);
      const closeAt = clear ? 0 : normalizedScheduleAt(body.closeAt);
      if (!clear && !openAt && !closeAt) {
        return send(res, 400, { error: "至少设置一个定时开放或定时关闭时间。" });
      }
      if (openAt && openAt <= Date.now()) {
        return send(res, 400, { error: "定时开放时间必须晚于当前时间。" });
      }
      if (closeAt && closeAt <= Date.now()) {
        return send(res, 400, { error: "定时关闭时间必须晚于当前时间。" });
      }
      if (openAt && closeAt && openAt === closeAt) {
        return send(res, 400, { error: "定时开放和定时关闭不能设置为同一时间。" });
      }
      const saved = saveShareState({
        ...shareState,
        scheduleOpenAt: openAt,
        scheduleCloseAt: closeAt,
        updatedAt: Date.now(),
        reason: clear ? "schedule-cleared" : "schedule-updated",
      });
      if (!saved) return send(res, 500, { error: "定时设置未能写入数据目录。", state: adminState() });
      return send(res, 200, adminState());
    }
    if (action !== "open" && action !== "close") {
      return send(res, 400, { error: "未知的入口状态操作。" });
    }
    const open = action === "open";
    const saved = saveShareState({
      ...shareState,
      open,
      updatedAt: Date.now(),
      reason: open ? "manual-open" : "manual-close",
    });
    if (!saved) {
      return send(res, 500, {
        error: "入口状态已在本进程关闭或开放，但写入磁盘失败。重启前请检查数据目录权限并重试。",
        state: adminState(),
      });
    }
    return send(res, 200, adminState());
  }

  if (p === "/api/admin/stats") {
    if (!adminOk) return send(res, 403, { error: "没有管理权限" });
    return send(res, 200, dataStats());
  }

  if (p === "/api/admin/backup") {
    if (!adminOk) return send(res, 403, { error: "没有管理权限" });
    const files = url.searchParams.get("files");
    return send(res, 200, buildBackup({ uploads: files === null ? true : files !== "0" }));
  }

  if (req.method === "POST" && p === "/api/admin/restore") {
    if (!adminOk) return send(res, 403, { error: "没有管理权限" });
    let raw;
    try {
      raw = await readBodyBuffer(req);
    } catch (err) {
      return send(res, 413, { error: String((err && err.message) || err) });
    }
    const body = parseJsonBody(raw);
    if (!body) return send(res, 400, { error: "备份文件不是有效的 JSON" });
    const b = body.backup || body;
    if (!b || typeof b !== "object" || Array.isArray(b)) return send(res, 400, { error: "备份文件格式不对" });
    const restored = restoreBackup(b);
    return send(res, 200, { ok: true, restored, stats: dataStats() });
  }

  if (!entry.owner && !siteOpen()) {
    return send(res, 503, closedPage(), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8"), "text/html; charset=utf-8");
  }
  if (req.method === "GET" && p.startsWith("/scenario/")) {
    const encodedId = p.slice("/scenario/".length);
    let scenarioId = "";
    try {
      scenarioId = decodeURIComponent(encodedId);
    } catch {}
    if (!scenarioId || scenarioId.includes("/") || !scenarioMeta(entry, scenarioId)) {
      return send(res, 404, "not found", "text/plain; charset=utf-8");
    }
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8"), "text/html; charset=utf-8");
  }
  if (
    req.method === "GET" &&
    (p === "/app.js" || p === "/i18n.js" || p === "/style.css" || p === "/bottom-nav.js" || p === "/bottom-nav.css")
  ) {
    const type = p.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
    const name = p.slice(1);
    if (!fs.existsSync(path.join(PUBLIC, name))) return send(res, 404, "not found", "text/plain; charset=utf-8");
    res.setHeader("cache-control", "no-cache");
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, name), "utf8"), type);
  }

  // 第三方库（PPT 导出）放本地，避免依赖外部 CDN
  if (req.method === "GET" && p.startsWith("/vendor/")) {
    const name = p.slice("/vendor/".length);
    if (!/^[a-z0-9._-]+$/i.test(name)) return send(res, 404, "not found", "text/plain; charset=utf-8");
    const file = path.join(PUBLIC, "vendor", name);
    if (!fs.existsSync(file)) return send(res, 404, "not found", "text/plain; charset=utf-8");
    const type = name.endsWith(".css")
      ? "text/css; charset=utf-8"
      : name.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "application/octet-stream";
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "public, max-age=2592000");
    res.setHeader("x-content-type-options", "nosniff");
    res.end(fs.readFileSync(file));
    return;
  }
  if (p === "/api/ping") {
    return send(res, 200, {
      ok: true,
      model: engine.config.model,
      modelLabel: engine.modelDisplayName(engine.config.model),
      shared: Boolean(shareKey),
      commit: String(process.env.RENDER_GIT_COMMIT || "").slice(0, 7) || "local",
    });
  }
  if (p === "/api/meta") {
    return send(res, 200, {
      // 本机/内网打开页面时，分享链接要回落到这个公开地址
      publicBase: String(engine.config.publicBase || "https://paotuan.onrender.com"),
      scenarios: scenarioListFor(entry),
      presets: engine.listPresets(presetDirFor(entry)),
      attrs: engine.ATTRS,
      skills: engine.SKILLS,
      difficulty: engine.DIFFICULTY,
      settings: engine.getSettings(),
      narrativeLengths: Object.keys(engine.NARRATIVE_LENGTH),
      attrPoints: engine.ATTR_POINTS,
      attrMin: engine.ATTR_MIN,
      attrMax: engine.ATTR_MAX,
      model: engine.config.model,
      modelLabel: engine.modelDisplayName(engine.config.model),
      isOwner: entry.owner,
      siteOpen: siteOpen(),
      guestTurnLimit: entry.owner ? null : guestTurnLimit,
      hasSave: Boolean(entry.session),
    });
  }
  if (req.method === "POST" && p === "/api/i18n/translate") {
    const body = await readBody(req);
    const language = engine.normalizeLanguage(body.language);
    if (language === "zh-Hans") return send(res, 200, { translations: {}, cached: true });
    const texts = [...new Set(
      (Array.isArray(body.texts) ? body.texts : [])
        .map((text) => String(text || "").trim().slice(0, 5000))
        .filter(Boolean)
    )].slice(0, 36);
    if (!texts.length) return send(res, 200, { translations: {}, cached: true });
    const translations = {};
    const missing = [];
    for (const text of texts) {
      const key = translationCacheKey(language, text);
      if (i18nCache[key]) translations[text] = i18nCache[key];
      else missing.push(text);
    }
    return send(res, 200, {
      translations,
      cached: true,
      partial: missing.length > 0,
      missing: missing.length,
      modelCalls: 0,
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
  if (p === "/api/scenario/detail") {
    const id = url.searchParams.get("id") || "";
    // 不可见的剧本（别人的私密剧本）按不存在处理
    if (!scenarioMeta(entry, id)) return send(res, 404, { error: "找不到这个剧本" });
    let scn = null;
    try {
      scn = engine.readScenarioRaw(id, guestDir(entry));
    } catch {
      return send(res, 404, { error: "找不到这个剧本" });
    }
    const trim = (value, max) => String(value || "").slice(0, max);
    return send(res, 200, {
      id,
      title: trim(scn.title, 80),
      genre: trim(scn.genre, 60),
      blurb: trim(scn.blurb, 400),
      intro: trim(scn.intro, 2400),
      tips: trim(scn.tips, 1200),
      author: trim(scn.author, 60),
      duration: trim(scn.duration, 60),
      players: trim(scn.players, 40) || "单人",
      rating: trim(scn.rating, 60),
      tags: (Array.isArray(scn.tags) ? scn.tags : []).slice(0, 12).map((t) => trim(t, 20)),
      cover: trim(scn.cover, 200),
      coverStyle: engine.sanitizeCoverStyle ? engine.sanitizeCoverStyle(scn.coverStyle) : null,
      playStyle: scn.playStyle === "open-world" ? "open-world" : "content",
      version: trim(scn.version, 20),
      versionNote: trim(scn.versionNote, 400),
      background: trim(scn.background, 1200),
      hook: trim(scn.hook, 600),
      startLocation: trim(scn.startLocation, 120),
      npcs: (Array.isArray(scn.npcs) ? scn.npcs : [])
        .map((n) => ({ name: trim(n?.name, 30), desc: trim(n?.desc, 120) }))
        .filter((n) => n.name)
        .slice(0, 8),
      openings: (Array.isArray(scn.openingOptions) ? scn.openingOptions : [])
        .map((o) => trim(typeof o === "string" ? o : o?.text || o?.title, 120))
        .filter(Boolean)
        .slice(0, 6),
      scheduleCount: (Array.isArray(scn.schedule) ? scn.schedule : []).length,
      clueCount: (Array.isArray(scn.clues) ? scn.clues : []).length,
      endingCount: (Array.isArray(scn.endings) ? scn.endings : []).length,
      linksCount: (Array.isArray(scn.links) ? scn.links : []).length,
      hasOpening: Boolean(scn.opening),
      custom: Boolean(scn.custom),
      visibility: scn.visibility === "private" || scn.visibility === "contacts" ? scn.visibility : "public",
      mine: Boolean(ownScenario(entry, id)),
      social: scenarioSocialView(id, entry.sid),
    });
  }

  if (p === "/api/scenario/social" && req.method === "GET") {
    const id = String(url.searchParams.get("id") || "");
    const scenario = visibleScenario(entry, id);
    if (!scenario) return send(res, 404, { error: "找不到这个剧本" });
    return send(res, 200, { social: scenarioSocialView(id, entry.sid) });
  }

  if (req.method === "POST" && (p === "/api/scenario/like" || p === "/api/scenario/favorite")) {
    const body = await readBody(req);
    const id = String(body.id || "");
    const scenario = visibleScenario(entry, id);
    if (!scenario) return send(res, 404, { error: "找不到这个剧本" });
    const item = ensureScenarioSocial(id);
    if (p.endsWith("/like")) toggleSidLike(item, entry.sid);
    else {
      const index = item.favorites.indexOf(entry.sid);
      if (index >= 0) item.favorites.splice(index, 1);
      else item.favorites.push(entry.sid);
    }
    item.updatedAt = Date.now();
    writeJsonFile(SCENARIO_SOCIAL_FILE, scenarioSocial);
    return send(res, 200, { social: scenarioSocialView(id, entry.sid) });
  }

  if (req.method === "POST" && p === "/api/scenario/forward") {
    const body = await readBody(req);
    const id = String(body.id || "");
    const scenario = visibleScenario(entry, id);
    if (!scenario) return send(res, 404, { error: "找不到这个剧本" });
    const item = ensureScenarioSocial(id);
    item.shares += 1;
    item.updatedAt = Date.now();
    writeJsonFile(SCENARIO_SOCIAL_FILE, scenarioSocial);
    return send(res, 200, {
      social: scenarioSocialView(id, entry.sid),
      shareUrl: scenarioShareUrl(id),
    });
  }

  if (req.method === "POST" && p === "/api/scenario/comment") {
    const body = await readBody(req);
    const id = String(body.id || "");
    const scenario = visibleScenario(entry, id);
    if (!scenario) return send(res, 404, { error: "找不到这个剧本" });
    const text = String(body.text || "").trim().slice(0, 500);
    if (!text) return send(res, 400, { error: "写点内容再评论" });
    const last = communityLast.get("scenario-" + entry.sid) || 0;
    if (Date.now() - last < 5000) return send(res, 429, { error: "评论太快了，稍等。" });
    communityLast.set("scenario-" + entry.sid, Date.now());
    const profile = loadProfileFor(entry.sid);
    const item = ensureScenarioSocial(id);
    const parentId = String(body.parentId || "");
    if (parentId) {
      const parent = item.comments.find((comment) => comment.id === parentId);
      if (!parent) return send(res, 404, { error: "要回复的评论不存在" });
      const replyToId = String(body.replyToId || "");
      const target = replyToId ? parent.replies.find((reply) => reply.id === replyToId) : null;
      parent.replies.push({
        id: crypto.randomUUID(),
        sid: entry.sid,
        who: profile.name || "匿名旅人",
        avatar: profile.avatar || "",
        text,
        at: new Date().toISOString(),
        replyToName: target ? target.who || "匿名旅人" : "",
        replyToSid: target?.sid || "",
        likes: [],
      });
      while (parent.replies.length > 50) parent.replies.shift();
    } else {
      item.comments.push({
        id: crypto.randomUUID(),
        sid: entry.sid,
        who: profile.name || "匿名旅人",
        avatar: profile.avatar || "",
        text,
        at: new Date().toISOString(),
        editedAt: null,
        likes: [],
        replies: [],
      });
      while (item.comments.length > 80) item.comments.shift();
    }
    item.updatedAt = Date.now();
    writeJsonFile(SCENARIO_SOCIAL_FILE, scenarioSocial);
    return send(res, 200, { social: scenarioSocialView(id, entry.sid) });
  }

  if (req.method === "POST" && p === "/api/scenario/comment/like") {
    const body = await readBody(req);
    const id = String(body.id || "");
    const item = ensureScenarioSocial(id);
    const comment = item.comments.find((entryItem) => entryItem.id === String(body.commentId || ""));
    if (!comment) return send(res, 404, { error: "评论不存在" });
    const replyId = String(body.replyId || "");
    const target = replyId ? comment.replies.find((reply) => reply.id === replyId) : comment;
    if (!target) return send(res, 404, { error: "回复不存在" });
    toggleSidLike(target, entry.sid);
    item.updatedAt = Date.now();
    writeJsonFile(SCENARIO_SOCIAL_FILE, scenarioSocial);
    return send(res, 200, { social: scenarioSocialView(id, entry.sid) });
  }

  if (req.method === "POST" && (p === "/api/scenario/comment/edit" || p === "/api/scenario/comment/delete")) {
    const body = await readBody(req);
    const id = String(body.id || "");
    const item = ensureScenarioSocial(id);
    const comment = item.comments.find((entryItem) => entryItem.id === String(body.commentId || ""));
    if (!comment) return send(res, 404, { error: "评论不存在" });
    const replyId = String(body.replyId || "");
    const target = replyId ? comment.replies.find((reply) => reply.id === replyId) : comment;
    if (!target) return send(res, 404, { error: "回复不存在" });
    if (target.sid !== entry.sid) return send(res, 403, { error: "只能修改或删除自己的评论" });
    if (p.endsWith("/delete")) {
      if (replyId) comment.replies = comment.replies.filter((reply) => reply.id !== replyId);
      else item.comments = item.comments.filter((entryItem) => entryItem.id !== comment.id);
    } else {
      const text = String(body.text || "").trim().slice(0, 500);
      if (!text) return send(res, 400, { error: "评论内容不能为空" });
      target.text = text;
      target.editedAt = new Date().toISOString();
    }
    item.updatedAt = Date.now();
    writeJsonFile(SCENARIO_SOCIAL_FILE, scenarioSocial);
    return send(res, 200, { social: scenarioSocialView(id, entry.sid) });
  }

  if (p === "/api/scenario") {
    if (req.method === "GET") {
      const id = url.searchParams.get("id") || "";
      if (!entry.owner && !ownScenario(entry, id)) {
        return send(res, 403, { error: "只能读取和编辑你自己创建的剧本原稿。" });
      }
      const scenario = visibleScenario(entry, id);
      if (!scenario) return send(res, 404, { error: "找不到这个剧本" });
      try {
        return send(res, 200, { scenario });
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
        scenarios: scenarioListFor(entry),
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
        scenarios: scenarioListFor(entry),
      });
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
  }
  const presetDir = presetDirFor(entry);
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
    const profile = loadProfileFor(entry.sid);
    if (profile.showOnline === false) presence.delete(entry.sid);
    else presence.set(entry.sid, Date.now());
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
      const sort = url.searchParams.get("sort") === "hot" ? "hot" : "time";
      const total = feedback.length;
      const pages = Math.max(1, Math.ceil(total / size));
      const page = Math.min(pages, Math.max(1, Number(url.searchParams.get("page")) || 1));
      const ordered = feedback.slice().sort((a, b) => {
        if (sort === "hot") {
          ensureFeedbackMessage(a);
          ensureFeedbackMessage(b);
          const hotScore = (message) =>
            message.likes.length +
            message.replies.length * 2 +
            message.replies.reduce((sum, reply) => sum + (reply.likes || []).length, 0);
          const hotA = hotScore(a);
          const hotB = hotScore(b);
          if (hotA !== hotB) return hotB - hotA;
        }
        return String(b.at || "").localeCompare(String(a.at || ""));
      });
      const slice = ordered.slice((page - 1) * size, page * size);
      const messages = slice.map((m) => feedbackView(m, entry.sid));
      return send(res, 200, { messages, total, page, pages, size, sort, ...voteSnapshot(entry.sid) });
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
      likes: [],
      replies: [],
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

  if (req.method === "POST" && p === "/api/feedback/like") {
    const body = await readBody(req);
    const message = feedback.find((item) => item.id === String(body.id || ""));
    if (!message) return send(res, 404, { error: "留言不存在" });
    ensureFeedbackMessage(message);
    const liked = toggleSidLike(message, entry.sid);
    writeJsonFile(FEEDBACK_FILE, feedback);
    return send(res, 200, { ok: true, liked, likes: message.likes.length });
  }

  if (req.method === "POST" && p === "/api/feedback/reply") {
    const body = await readBody(req);
    const message = feedback.find((item) => item.id === String(body.id || ""));
    if (!message) return send(res, 404, { error: "留言不存在" });
    const text = String(body.text || "").trim().slice(0, 300);
    if (!text) return send(res, 400, { error: "回复内容不能为空" });
    const last = lastPostAt.get("reply-" + entry.sid) || 0;
    if (Date.now() - last < 5000) return send(res, 429, { error: "回复太快了，稍等。" });
    lastPostAt.set("reply-" + entry.sid, Date.now());
    ensureFeedbackMessage(message);
    const replyToId = String(body.replyToId || "");
    const target = replyToId ? message.replies.find((reply) => reply.id === replyToId) : null;
    const profile = loadProfileFor(entry.sid);
    message.replies.push({
      id: crypto.randomUUID(),
      sid: entry.sid,
      name: profile.name || "匿名旅人",
      avatar: profile.avatar || "",
      text,
      at: new Date().toISOString(),
      replyToName: target ? target.name || "匿名旅人" : "",
      replyToSid: target?.sid || "",
      likes: [],
    });
    while (message.replies.length > 80) message.replies.shift();
    writeJsonFile(FEEDBACK_FILE, feedback);
    return send(res, 200, { ok: true, message: feedbackView(message, entry.sid) });
  }

  if (req.method === "POST" && p === "/api/feedback/reply/like") {
    const body = await readBody(req);
    const message = feedback.find((item) => item.id === String(body.id || ""));
    if (!message) return send(res, 404, { error: "留言不存在" });
    ensureFeedbackMessage(message);
    const reply = message.replies.find((item) => item.id === String(body.replyId || ""));
    if (!reply) return send(res, 404, { error: "回复不存在" });
    const liked = toggleSidLike(reply, entry.sid);
    writeJsonFile(FEEDBACK_FILE, feedback);
    return send(res, 200, { ok: true, liked, likes: reply.likes.length });
  }

  if (p === "/api/me") {
    if (req.method === "GET") return send(res, 200, publicProfileView(loadProfileFor(entry.sid)));
    const body = await readBody(req);
    return send(res, 200, publicProfileView(saveProfileFor(entry.sid, body)));
  }

  if (p === "/api/privacy/export" && req.method === "GET") {
    return send(res, 200, privacyExportData(entry));
  }

  if (req.method === "POST" && p === "/api/privacy/delete") {
    if (entry.owner) return send(res, 403, { error: "房主账号请在后台备份并处理，本站内不允许删除管理员数据。" });
    const body = await readBody(req);
    if (String(body.confirm || "") !== "删除我的数据") {
      return send(res, 400, { error: "请完整输入“删除我的数据”后再确认。" });
    }
    const sid = entry.sid;
    const profile = loadProfileFor(sid);
    const ownScenarios = listOwnScenarios(entry);
    const ownPresets = engine.listPresets(presetDirFor(entry));
    const uploadCandidates = new Set();
    collectUploadUrls(profile, uploadCandidates);
    collectUploadUrls(ownScenarios, uploadCandidates);
    collectUploadUrls(community.filter((post) => post.sid === sid), uploadCandidates);
    const removedPosts = community.filter((post) => post.sid === sid).length;
    community = community.filter((post) => post.sid !== sid);
    for (const post of community) {
      removeSidLikes(post, sid);
      post.comments = (post.comments || []).filter((comment) => comment.sid !== sid);
      for (const comment of post.comments) {
        removeSidLikes(comment, sid);
        comment.replies = (comment.replies || []).filter((reply) => reply.sid !== sid);
      }
    }
    const removedFeedback = feedback.filter((message) => message.sid === sid).length;
    feedback = feedback.filter((message) => message.sid !== sid);
    for (const message of feedback) {
      removeSidLikes(message, sid);
      message.replies = (message.replies || []).filter((reply) => reply.sid !== sid);
    }
    const ownGroups = communityGroups.filter((group) => group.ownerSid === sid);
    for (const group of ownGroups) {
      group.ownerSid = "";
      group.ownerPid = "";
      group.ownerName = "已注销用户";
    }
    for (const item of Object.values(scenarioSocial)) {
      if (!item || typeof item !== "object") continue;
      item.likes = (item.likes || []).filter((value) => value !== sid);
      item.favorites = (item.favorites || []).filter((value) => value !== sid);
      item.comments = (item.comments || []).filter((comment) => comment.sid !== sid);
      for (const comment of item.comments) {
        removeSidLikes(comment, sid);
        comment.replies = (comment.replies || []).filter((reply) => reply.sid !== sid);
      }
    }
    let removedRooms = 0;
    for (const [code, room] of Object.entries(rooms)) {
      if (room.hostSid === sid) {
        delete rooms[code];
        removedRooms += 1;
        continue;
      }
      const player = room.players?.find((item) => item.sid === sid);
      if (player?.pid && room.state?.status) delete room.state.status[player.pid];
      room.players = (room.players || []).filter((item) => item.sid !== sid);
      delete room.actions?.[sid];
    }
    const previousVote = votes.voters[sid];
    if (previousVote) votes[previousVote] = Math.max(0, (Number(votes[previousVote]) || 0) - 1);
    delete votes.voters[sid];
    presence.delete(sid);

    for (const scenario of ownScenarios) {
      try {
        engine.deleteCustomScenario(scenario.id, ownScenarioDir(entry));
      } catch {}
    }
    for (const preset of ownPresets) {
      try {
        engine.deletePreset(preset.name, presetDirFor(entry));
      } catch {}
    }
    for (const file of [userFile(sid), promptProfileFile(sid), modelFile(sid), sessFile(sid)]) {
      try {
        if (file && fs.existsSync(file)) fs.unlinkSync(file);
      } catch {}
    }
    entry.session = null;
    store.delete(sid);
    writeJsonFile(COMMUNITY_FILE, community);
    writeJsonFile(COMMUNITY_GROUPS_FILE, communityGroups);
    writeJsonFile(FEEDBACK_FILE, feedback);
    writeJsonFile(VOTES_FILE, votes);
    writeJsonFile(SCENARIO_SOCIAL_FILE, scenarioSocial);
    saveRooms();
    const remainingUploads = new Set();
    collectUploadUrls({
      community,
      communityGroups,
      feedback,
      scenarioSocial,
      rooms,
      users: readJsonDirFiles(USERS_DIR),
      scenarios: engine.listScenarios(undefined, { owner: true }),
    }, remainingUploads);
    for (const name of uploadCandidates) {
      if (remainingUploads.has(name)) continue;
      try {
        const file = path.join(UPLOAD_DIR, name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {}
    }
    const nextSid = crypto.randomBytes(12).toString("hex");
    setCookie(res, clientCookie("tg_sid", nextSid, 2592000));
    return send(res, 200, {
      ok: true,
      removed: {
        scenarios: ownScenarios.length,
        presets: ownPresets.length,
        posts: removedPosts,
        feedback: removedFeedback,
        rooms: removedRooms,
        groupsAnonymized: ownGroups.length,
      },
    });
  }

  if (p === "/api/gm-console") {
    if (req.method === "GET") {
      return send(res, 200, {
        profile: loadPromptProfileFor(entry.sid),
        defaults: PROMPT_PROFILE_DEFAULTS,
        baseRules: engine.publicGmRules(),
        limits: { customChars: 6000, scenarioChars: 3000 },
      });
    }
    const body = await readBody(req);
    return send(res, 200, savePromptProfileFor(entry.sid, body));
  }

  if (req.method === "POST" && p === "/api/upload") {
    const body = await readBody(req);
    try {
      const staticOnly = body.kind === "scenario-visual";
      const out = saveUpload(body.data, String(body.mime || ""), body.avatar ? AVATAR_MAX : UPLOAD_MAX, {
        staticOnly,
        avatarOnly: Boolean(body.avatar),
        ownerUsageBytes: uploadBytesForEntry(entry),
      });
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

  if (p === "/api/community/groups") {
    if (req.method === "GET") {
      return send(res, 200, {
        groups: communityGroups.map((group) => communityGroupView(group, entry.sid)),
      });
    }
    if (req.method !== "POST") return send(res, 405, { error: "只允许 GET 或 POST" });
    const body = await readBody(req);
    const name = String(body.name || "").trim().slice(0, 30);
    const description = String(body.description || "").trim().slice(0, 300);
    if (name.length < 2) return send(res, 400, { error: "社区名称至少需要 2 个字。" });
    const duplicate = [...COMMUNITY_CATEGORIES, ...communityGroups.map((group) => group.name)]
      .some((value) => String(value || "").trim().toLowerCase() === name.toLowerCase());
    if (duplicate) return send(res, 409, { error: "这个社区名称已经存在。" });
    const last = communityLast.get("group-" + entry.sid) || 0;
    if (Date.now() - last < 20000) return send(res, 429, { error: "创建社区太快了，稍等一会儿。" });
    if (communityGroups.length >= 500) return send(res, 400, { error: "社区数量已经达到存储上限。" });
    let profile = loadProfileFor(entry.sid);
    if (!profile.pid) profile = saveProfileFor(entry.sid, {});
    const group = {
      id: `community-${crypto.randomBytes(6).toString("hex")}`,
      name,
      description,
      ownerSid: entry.sid,
      ownerPid: profile.pid || "",
      ownerName: profile.name || "匿名旅人",
      createdAt: new Date().toISOString(),
    };
    communityLast.set("group-" + entry.sid, Date.now());
    communityGroups.push(group);
    writeJsonFile(COMMUNITY_GROUPS_FILE, communityGroups);
    return send(res, 200, {
      ok: true,
      group: communityGroupView(group, entry.sid),
      groups: communityGroups.map((item) => communityGroupView(item, entry.sid)),
    });
  }

  if (p === "/api/community") {
    if (req.method === "GET") {
      const mine = url.searchParams.get("mine") === "1";
      const source = mine ? community.filter((x) => x.sid === entry.sid) : community;
      return send(res, 200, {
        posts: source.slice(-200).reverse().map((x) => communityView(x, entry.sid)),
        groups: communityGroups.map((group) => communityGroupView(group, entry.sid)),
      });
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
    const communityId = String(body.communityId || "");
    const group = communityGroups.find((item) => item.id === communityId);
    const post = {
      id: crypto.randomUUID(),
      sid: entry.sid,
      author: profile.name || "匿名旅人",
      avatar: profile.avatar || "",
      title,
      text,
      media,
      category: COMMUNITY_CATEGORIES.includes(body.category) ? body.category : "现实",
      origin: COMMUNITY_ORIGINS.includes(body.origin) ? body.origin : "原创",
      communityId: group ? group.id : "",
      tags: (Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(/[,，、]/))
        .map((t) => String(t).trim().slice(0, 16))
        .filter(Boolean),
      comments: [],
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

  if (req.method === "POST" && p === "/api/community/comment") {
    const body = await readBody(req);
    const post = community.find((x) => x.id === String(body.postId || ""));
    if (!post) return send(res, 404, { error: "作品不存在" });
    const text = String(body.text || "").trim().slice(0, 300);
    if (!text) return send(res, 400, { error: "写点内容再评论" });
    const last = communityLast.get("c-" + entry.sid) || 0;
    if (Date.now() - last < 10000) return send(res, 429, { error: "评论太快了，稍等。" });
    communityLast.set("c-" + entry.sid, Date.now());
    const prof = loadProfileFor(entry.sid);
    ensureCommunityComments(post);
    const parentId = String(body.parentId || "");
    if (parentId) {
      const parent = post.comments.find((comment) => comment.id === parentId);
      if (!parent) return send(res, 404, { error: "要回复的评论不存在" });
      const replyToId = String(body.replyToId || "");
      const target = replyToId ? parent.replies.find((reply) => reply.id === replyToId) : null;
      parent.replies.push({
        id: crypto.randomUUID(),
        sid: entry.sid,
        who: prof.name || "匿名旅人",
        avatar: prof.avatar || "",
        text,
        at: new Date().toISOString(),
        replyToName: target ? target.who || "匿名旅人" : "",
        replyToSid: target?.sid || "",
        likes: [],
      });
      while (parent.replies.length > 50) parent.replies.shift();
    } else {
      post.comments.push({
        id: crypto.randomUUID(),
        sid: entry.sid,
        who: prof.name || "匿名旅人",
        avatar: prof.avatar || "",
        text,
        at: new Date().toISOString(),
        likes: [],
        replies: [],
      });
    }
    while (post.comments.length > 50) post.comments.shift();
    writeJsonFile(COMMUNITY_FILE, community);
    return send(res, 200, communityView(post, entry.sid));
  }

  if (req.method === "POST" && p === "/api/community/comment/like") {
    const body = await readBody(req);
    const post = community.find((x) => x.id === String(body.postId || ""));
    if (!post) return send(res, 404, { error: "作品不存在" });
    ensureCommunityComments(post);
    const comment = post.comments.find((item) => item.id === String(body.commentId || ""));
    if (!comment) return send(res, 404, { error: "评论不存在" });
    const replyId = String(body.replyId || "");
    const target = replyId ? comment.replies.find((item) => item.id === replyId) : comment;
    if (!target) return send(res, 404, { error: "回复不存在" });
    const liked = toggleSidLike(target, entry.sid);
    writeJsonFile(COMMUNITY_FILE, community);
    return send(res, 200, { ok: true, liked, likes: target.likes.length });
  }

  if (req.method === "POST" && p === "/api/community/delete") {
    const body = await readBody(req);
    const idx = community.findIndex((x) => x.id === String(body.id || ""));
    if (idx < 0) return send(res, 404, { error: "作品不存在" });
    if (community[idx].sid !== entry.sid) return send(res, 403, { error: "只能删除自己的作品" });
    community.splice(idx, 1);
    writeJsonFile(COMMUNITY_FILE, community);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && p === "/api/scenario/share") {
    const body = await readBody(req);
    const sc = ownScenario(entry, String(body.id || ""));
    if (!sc) return send(res, 400, { error: "只能分享你自己创作的剧本。" });
    const profile = loadProfileFor(entry.sid);
    const origin = COMMUNITY_ORIGINS.includes(body.origin) ? body.origin : "原创";
    const existing = community.find(
      (item) => item.type === "scenario" && item.sid === entry.sid && item.scenario?.id === sc.id
    );
    if (existing) {
      existing.author = profile.name || "匿名旅人";
      existing.avatar = profile.avatar || "";
      existing.title = sc.title;
      existing.text = sc.blurb || "";
      existing.category = COMMUNITY_CATEGORIES.includes(sc.genre) ? sc.genre : "奇幻";
      existing.origin = origin;
      existing.scenario = sc;
      existing.tags = sc.tags || [];
      existing.updatedAt = new Date().toISOString();
      writeJsonFile(COMMUNITY_FILE, community);
      return send(res, 200, {
        ok: true,
        updated: true,
        post: communityView(existing, entry.sid),
        shareUrl: scenarioShareUrl(sc.id),
      });
    }
    const last = communityLast.get(entry.sid) || 0;
    if (Date.now() - last < 30000) return send(res, 429, { error: "发得太快了，歇一会儿再分享。" });
    communityLast.set(entry.sid, Date.now());
    const post = {
      id: crypto.randomUUID(),
      type: "scenario",
      sid: entry.sid,
      pid: profile.pid || "",
      author: profile.name || "匿名旅人",
      avatar: profile.avatar || "",
      title: sc.title,
      text: sc.blurb || "",
      category: COMMUNITY_CATEGORIES.includes(sc.genre) ? sc.genre : "奇幻",
      origin,
      scenario: sc,
      tags: sc.tags || [],
      comments: [],
      media: null,
      at: new Date().toISOString(),
      likes: [],
    };
    community.push(post);
    while (community.length > 200) community.shift();
    writeJsonFile(COMMUNITY_FILE, community);
    return send(res, 200, {
      ok: true,
      updated: false,
      post: communityView(post, entry.sid),
      shareUrl: scenarioShareUrl(sc.id),
    });
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
      npcs: (s.npcs || []).length,
    }));
    return send(res, 200, { scenarios: list.sort((a, b) => a.title.localeCompare(b.title, "zh")) });
  }

  if (p === "/api/players") {
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const list = allProfiles()
      .filter((x) => x.discoverable !== false && x.showProfile !== false)
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
    if (prof.sid !== entry.sid && prof.showProfile === false) {
      return send(res, 404, { error: "这位玩家没有公开个人空间" });
    }
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
      .filter((x) => x.discoverable !== false && x.showProfile !== false)
      .filter((x) => String(x.name || "").toLowerCase().includes(q) || String(x.bio || "").toLowerCase().includes(q))
      .slice(0, 10)
      .map((x) => ({ pid: x.pid, name: x.name || "匿名旅人", avatar: x.avatar || "", bio: x.bio || "" }));
    const scenarios = engine
      .listScenarios(guestDir(entry), viewerFor(entry))
      .filter((scenario) =>
        [scenario.title, scenario.genre, scenario.blurb, scenario.author]
          .some((value) => String(value || "").toLowerCase().includes(q))
      )
      .slice(0, 20)
      .map((scenario) => ({
        id: scenario.id,
        title: scenario.title,
        genre: scenario.genre,
        blurb: scenario.blurb,
        author: scenario.author,
      }));
    return send(res, 200, { players, scenarios });
  }

  if (p === "/room" && req.method === "GET") {
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, "room.html"), "utf8"), "text/html; charset=utf-8");
  }

  if (req.method === "POST" && p === "/api/rooms/create") {
    const body = await readBody(req);
    const sc = visibleScenario(entry, String(body.scenarioId || ""));
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
      mode: engine.resolveMode(body.mode, sc),
      difficulty: ["easy", "normal", "hard"].includes(body.difficulty) ? body.difficulty : "normal",
      opening: String(body.opening || "").slice(0, 500),
      language: engine.normalizeLanguage(body.language),
      promptProfile: loadPromptProfileFor(entry.sid),
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
      state: newRoomState(sc),
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
    room.opening = room.opening || room.scenario.hook || "";
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
    if (room.mode === "free" && engine.violatesContentBoundary(text)) {
      return send(res, 400, { error: "这条行动触及网站禁止的现实敏感政治或严重违规内容，请换一个虚构且不涉及现实伤害的方向。" });
    }
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
    if (body.language != null) room.language = engine.normalizeLanguage(body.language);
    room.promptProfile = loadPromptProfileFor(room.hostSid);
    if (!Object.keys(room.actions).length) return send(res, 400, { error: "还没有人提交行动" });
    if (
      room.mode === "free" &&
      engine.violatesContentBoundary([
        ...Object.values(room.actions),
        String(room.promptProfile?.customInstructions || ""),
        String(room.scenario?.gmInstructions || ""),
      ].join("\n"))
    ) {
      return send(res, 400, { error: "本轮行动或自定义规则触及现实敏感政治或严重违规内容，请修改后再推进。" });
    }
    room.busy = true;
    try {
      room.research = await ensureScenarioResearch(room.scenario);
      const result = await engine.askModel(roomPrompt(room), { reasoningEffort: "low" }, usableModelFor(entry, room.hostSid));
      const parsed = engine.parseModelTurn(result.text);
      let narration = parsed.narrative || String(result.text || "").slice(0, 4000);
      if (
        room.mode === "free" &&
        engine.violatesContentBoundary([
          narration,
          ...(parsed.suggestions || []),
          JSON.stringify(parsed.state || {}),
        ].join("\n"))
      ) {
        narration = "本次生成触及网站禁止的现实敏感政治或严重违规范围，内容已被拦截。请换一个虚构且不涉及现实伤害的探索方向。";
        parsed.suggestions = [];
        parsed.state = { advance_minutes: 0 };
      }
      if (narration) room.log.push({ type: "gm", text: narration, suggestions: parsed.suggestions, at: Date.now() });
      const actionGate = engine.actionStateGate(Object.values(room.actions).join("\n"));
      applyRoomState(room, parsed.state || {}, actionGate);
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
    const scenario = visibleScenario(entry, String(s.scenarioId));
    if (!scenario) return send(res, 400, { error: "存档对应的剧本已经不存在。" });
    entry.session = s;
    entry.busy = false;
    saveEntry(entry);
    return send(res, 200, { ok: true, session: publicSession(entry) });
  }

  if (p === "/api/model") {
    if (req.method === "GET") {
      return send(res, 200, {
        ...publicModel(loadModelFor(entry.sid)),
        defaultModel: engine.config.model,
        defaultModelLabel: engine.modelDisplayName(engine.config.model),
      });
    }
    if (req.method === "DELETE") {
      try {
        if (fs.existsSync(modelFile(entry.sid))) fs.unlinkSync(modelFile(entry.sid));
      } catch {}
      return send(res, 200, { ok: true });
    }
    const body = await readBody(req);
    try {
      await validateModelDestination(entry, body.baseUrl || loadModelFor(entry.sid)?.baseUrl || "");
      return send(res, 200, publicModel(saveModelFor(entry.sid, body)));
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
  }

  if (req.method === "POST" && p === "/api/model/test") {
    const body = await readBody(req);
    const saved = loadModelFor(entry.sid);
    const cfg = {
      enabled: true,
      provider: String(body.provider || saved?.provider || "custom"),
      baseUrl: String(body.baseUrl || saved?.baseUrl || ""),
      model: String(body.model || saved?.model || ""),
      apiKey: String(body.apiKey || saved?.apiKey || ""),
    };
    if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) {
      return send(res, 400, { error: "Base URL、模型名和 Key 都要填齐。" });
    }
    try {
      await validateModelDestination(entry, cfg.baseUrl);
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
    return send(res, 200, {
      ok: true,
      reply: "配置格式有效；本次只检查字段，不发送计费请求。",
      modelCalls: 0,
    });
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
    if (!scenarioMeta(entry, String(body.scenarioId || ""))) {
      return send(res, 404, { error: "找不到这个剧本，或作者没有向你公开它。" });
    }
    const playerProtocol = engine.normalizePlayerProtocol(body.protocol);
    let fresh;
    try {
      fresh = engine.createSession({
        character: body.character || {},
        scenarioId: body.scenarioId,
        difficulty: body.difficulty || "normal",
        mode: body.mode,
        scenarioDir: guestDir(entry),
        language: body.language,
      });
      fresh.playerProtocol = playerProtocol;
    } catch (err) {
      return send(res, 400, { error: String(err.message || err) });
    }
    const scenario = visibleScenario(entry, fresh.scenarioId);
    if (!scenario) return send(res, 404, { error: "剧本已经不可用。" });
    fresh.promptProfile = loadPromptProfileFor(entry.sid);
    entry.busy = true;
    fresh.scenarioResearch = await ensureScenarioResearch(scenario);
    entry.session = fresh;
    await acquireSlot();
    if (!entry.owner) addGuestCalls(1);
    try {
      const opening = await engine.runOpening(entry.session, scenario, usableModelFor(entry));
      const firstGm = entry.session.log.find((e) => e.type === "gm");
      if (firstGm) entry.session.opening = firstGm.text;
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
    if (!entry.session) {
      return send(res, 409, {
        error: "这一局的进度在服务器上已经失效（通常是站点重启或重新部署导致）。",
        needNewGame: true,
      });
    }
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
    if (Array.isArray(body.protocol)) {
      entry.session.playerProtocol = engine.normalizePlayerProtocol(body.protocol);
    }
    if (body.language != null) entry.session.language = engine.normalizeLanguage(body.language);
    entry.session.promptProfile = loadPromptProfileFor(entry.sid);
    const scenario = visibleScenario(entry, entry.session.scenarioId);
    if (!scenario) return send(res, 403, { error: "剧本文件不存在，或作者已经取消了对你的公开。" });
    entry.busy = true;
    entry.session.scenarioResearch = await ensureScenarioResearch(scenario);
    await acquireSlot();
    if (!entry.owner) addGuestCalls(1);
    try {
      const out = await engine.runTurn(entry.session, scenario, text, usableModelFor(entry));
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

  if (req.method === "POST" && p === "/api/research/sync") {
    if (!entry.session) return send(res, 400, { error: "还没有开始游戏。" });
    if (entry.busy) return send(res, 429, { error: "当前回合正在处理中，稍后再同步资料。" });
    const scenario = visibleScenario(entry, entry.session.scenarioId);
    if (!scenario) return send(res, 404, { error: "剧本文件不存在，或作者已经取消了对你的公开。" });
    entry.busy = true;
    try {
      const result = await ensureScenarioResearch(scenario, true);
      entry.session.scenarioResearch = result;
      saveEntry(entry);
      return send(res, 200, { research: researchSnapshot(result) });
    } finally {
      entry.busy = false;
    }
  }

  if (req.method === "POST" && p === "/api/roll") {
    if (!entry.session) return send(res, 400, { error: "还没有开始游戏。" });
    const body = await readBody(req);
    const skill = String(body.skill || "侦查");
    const dc = Number(body.dc) || 15;
    const result = engine.rollCheck(entry.session.character, skill, dc, entry.session.difficulty);
    const line = `${result.skill}（主动判定）：d20=${result.roll}＋技能${result.skillBonus}=${result.total}　难度${result.dc}　${result.grade}`;
      entry.session.log.push({ type: "dice", text: line, at: engine.clockText(entry.session.time) });
    saveEntry(entry);
    return send(res, 200, {
      result,
      segments: [{ type: "dice", text: line, grade: result.grade }],
      session: publicSession(entry),
    });
  }

  return send(res, 404, "not found", "text/plain; charset=utf-8");
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;
server.maxHeadersCount = 100;
server.on("clientError", (error, socket) => {
  if (!socket.writable) return;
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
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

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of requestRateBuckets) {
    if (!bucket || now >= bucket.reset) requestRateBuckets.delete(key);
  }
  if (requestRateBuckets.size > 10_000) {
    const oldest = [...requestRateBuckets.entries()]
      .sort((a, b) => Number(a[1]?.reset || 0) - Number(b[1]?.reset || 0))
      .slice(0, requestRateBuckets.size - 8000);
    oldest.forEach(([key]) => requestRateBuckets.delete(key));
  }
  for (const [ip, record] of loginFails) {
    if (!record || now >= record.reset) loginFails.delete(ip);
  }
}, 5 * 60 * 1000).unref();

/* 定时入口只在到达用户设置的时间点时改变一次，其余时间不会调整营业状态。 */
applyDueShareSchedules();
setInterval(() => applyDueShareSchedules(), 1000).unref();

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
    console.log(`模型：${engine.modelDisplayName(engine.config.model)}（${engine.config.model}）`);
    console.log(`邀请码：${shareKey || "（未设置，任何人都能进）"}`);
  });
}

start(engine.config.port, 12);
