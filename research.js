/**
 * 联网资料校准：只从预设的可信来源抓取，不把任意搜索结果直接交给模型。
 * 数据会被清洗、相关性过滤、广告过滤和提示词注入过滤后，再由服务端缓存。
 */
const { htmlToText } = require("./linkfetch");

const MAX_SOURCES = 3;
const MAX_TEXT_PER_SOURCE = 2200;
const MAX_TOTAL_CHARS = 6000;

const TRUSTED_DOMAINS = new Set([
  "www.dc.com",
  "dc.com",
  "www.marvel.com",
  "marvel.com",
  "en.wikipedia.org",
  "zh.wikipedia.org",
  "www.bandainamcoent.eu",
  "en.bandainamcoent.eu",
  "arknights.global",
  "www.arknights.global",
  "jujutsukaisen.jp",
  "www.jujutsukaisen.jp",
  "fandom.com",
]);

const SOURCE_MAP = {
  "dc-central-city-stolen-seconds": [
    ["官方角色资料", "https://www.dc.com/characters/the-flash"],
    ["百科背景", "https://en.wikipedia.org/wiki/Central_City_(DC_Comics)"],
  ],
  "dc-gotham-midnight": [
    ["官方角色资料", "https://www.dc.com/characters/batman"],
    ["百科背景", "https://en.wikipedia.org/wiki/Gotham_City"],
  ],
  "dc-metropolis-redsun": [
    ["官方角色资料", "https://www.dc.com/characters/superman"],
    ["百科背景", "https://en.wikipedia.org/wiki/Metropolis_(comics)"],
  ],
  "dc-themyscira-shadowless": [
    ["官方角色资料", "https://www.dc.com/characters/wonder-woman"],
    ["百科背景", "https://en.wikipedia.org/wiki/Themyscira_(DC_Comics)"],
  ],
  "marvel-xmen-sentinel": [
    ["官方团队资料", "https://www.marvel.com/teams-and-groups/x-men"],
    ["百科背景", "https://en.wikipedia.org/wiki/X-Men"],
  ],
  "marvel-hells-kitchen-rain": [
    ["百科街区资料", "https://en.wikipedia.org/wiki/Hell%27s_Kitchen,_Manhattan"],
    ["社群补充资料", "https://marvel.fandom.com/wiki/Daredevil"],
  ],
  "marvel-queens-last-train": [
    ["百科行政区资料", "https://en.wikipedia.org/wiki/Queens"],
    ["社群补充资料", "https://marvel.fandom.com/wiki/Spider-Man"],
  ],
  "marvel-sanctum-three-nights": [
    ["百科场景资料", "https://en.wikipedia.org/wiki/Sanctum_Sanctorum"],
    ["社群补充资料", "https://marvel.fandom.com/wiki/Doctor_Strange"],
  ],
  "elden-grace": [
    ["百科背景", "https://en.wikipedia.org/wiki/Elden_Ring"],
    ["官方资料", "https://en.bandainamcoent.eu/elden-ring/elden-ring"],
  ],
  "jjk-shibuya": [
    ["官方资料", "https://jujutsukaisen.jp/"],
    ["百科背景", "https://en.wikipedia.org/wiki/Jujutsu_Kaisen"],
  ],
  "touhou-barrier": [
    ["百科背景", "https://en.wikipedia.org/wiki/Touhou_Project"],
    ["社群补充资料", "https://touhou.fandom.com/wiki/Gensokyo"],
  ],
  "arknights-core": [
    ["官方资料", "https://arknights.global/"],
    ["百科背景", "https://en.wikipedia.org/wiki/Arknights"],
  ],
  "lu-house": [
    ["百科背景", "https://en.wikipedia.org/wiki/Jiangnan"],
    ["百科建筑资料", "https://zh.wikipedia.org/wiki/%E6%B1%9F%E5%8D%97%E6%B0%B4%E4%B9%A1"],
  ],
  "fog-light": [
    ["百科背景", "https://en.wikipedia.org/wiki/Lighthouse"],
    ["百科地理资料", "https://en.wikipedia.org/wiki/Tide"],
  ],
};

const AD_PATTERNS = [
  /(?:立即购买|立即下载|优惠|折扣|代购|推广|广告|加微信|QQ群|扫码|点击领取|限时特价|博彩|彩票|贷款|招商加盟)/gi,
  /(?:buy now|limited offer|discount|sponsored|affiliate|coupon|download now|sign up now)/gi,
];
const INJECTION_PATTERNS = [
  /ignore (?:all )?(?:previous|above) instructions/i,
  /system prompt|developer message|api key|secret key/i,
  /忽略(?:之前|以上)(?:所有)?(?:指令|要求)|系统提示词|开发者消息|密钥/i,
];

function allowedUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    return /^https?:$/.test(url.protocol) && [...TRUSTED_DOMAINS].some((domain) => url.hostname === domain || url.hostname.endsWith("." + domain));
  } catch {
    return false;
  }
}

function cleanResearchText(text) {
  return String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/\u0000/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sourceAuthority(url) {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (/dc\.com|marvel\.com|bandainamcoent\.eu|arknights\.global|jujutsukaisen\.jp/.test(host)) return "官方";
  if (/wikipedia\.org/.test(host)) return "百科";
  return "社群参考";
}

async function fetchResearchPage(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "PaotuanResearch/1.0 (+https://paotuan.onrender.com)",
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`);
  const contentType = String(response.headers.get("content-type") || "");
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > 600000) throw new Error("来源页面过大");
  const chunks = [];
  let bytes = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 600000) {
        await reader.cancel().catch(() => {});
        throw new Error("来源页面过大");
      }
      chunks.push(Buffer.from(value));
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || url;
  return {
    url,
    title: htmlToText(title).slice(0, 100),
    text: /html|xml/i.test(contentType) ? htmlToText(raw) : raw.trim(),
  };
}

function relevanceTerms(scenario) {
  const source = [
    scenario.title,
    scenario.genre,
    ...(scenario.tags || []),
    ...(scenario.npcs || []).slice(0, 4).map((npc) => npc.name),
  ].join(" ");
  return [...new Set(source.match(/[A-Za-z0-9\u4e00-\u9fff]{2,12}/g) || [])]
    .filter((term) => !/^(开放|世界|角色|人物|故事|the|and|of)$/i.test(term))
    .slice(0, 12);
}

function filterSource(candidate, scenario) {
  const raw = cleanResearchText(candidate.text);
  if (raw.length < 180) return { rejected: "正文过少" };
  const adHits = AD_PATTERNS.reduce((sum, pattern) => sum + ((raw.match(pattern) || []).length), 0);
  if (adHits > 2) return { rejected: "疑似营销或广告页面" };
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(raw))) return { rejected: "包含疑似提示词注入" };
  const terms = relevanceTerms(scenario);
  const matched = terms.filter((term) => raw.toLowerCase().includes(term.toLowerCase()) || String(candidate.title || "").toLowerCase().includes(term.toLowerCase()));
  if (terms.length && matched.length === 0) return { rejected: "与剧本主题不相关" };
  const paragraphs = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 35 && line.length <= 600)
    .filter((line) => adHits === 0 || !AD_PATTERNS.some((pattern) => pattern.test(line)));
  const text = (paragraphs.length ? paragraphs.join("\n") : raw).slice(0, MAX_TEXT_PER_SOURCE);
  if (text.length < 180) return { rejected: "清洗后正文过少" };
  return {
    title: String(candidate.title || candidate.url).slice(0, 100),
    url: candidate.url,
    authority: sourceAuthority(candidate.url),
    fetchedAt: new Date().toISOString(),
    text,
    chars: text.length,
  };
}

async function researchScenario(scenario) {
  const entries = SOURCE_MAP[scenario.id] || [];
  const sources = [];
  const rejected = [];
  let total = 0;
  const results = await Promise.all(entries.slice(0, MAX_SOURCES).map(async ([label, url]) => {
    if (!allowedUrl(url)) {
      return { label, url, rejected: "来源不在可信域名列表" };
    }
    try {
      const page = await fetchResearchPage(url);
      const filtered = filterSource({ ...page, title: label + " · " + page.title }, scenario);
      if (filtered.rejected) return { label, url, rejected: filtered.rejected };
      filtered.label = label;
      return { label, url, source: filtered };
    } catch (error) {
      return { label, url, rejected: String(error.message || error).slice(0, 120) };
    }
  }));
  for (const result of results) {
    if (result.rejected || !result.source) {
      rejected.push({ title: result.label, url: result.url, reason: result.rejected || "未通过筛选" });
      continue;
    }
    const remaining = MAX_TOTAL_CHARS - total;
    if (remaining <= 250) break;
    if (result.source.text.length > remaining) result.source.text = result.source.text.slice(0, remaining);
    result.source.chars = result.source.text.length;
    total += result.source.chars;
    sources.push(result.source);
  }
  return {
    fetchedAt: new Date().toISOString(),
    sources,
    rejected,
    ok: sources.length > 0,
  };
}

module.exports = {
  researchScenario,
  researchSourcesFor: (scenarioId) => (SOURCE_MAP[scenarioId] || []).map(([label, url]) => ({ label, url })),
  allowedUrl,
  relevanceTerms,
};
