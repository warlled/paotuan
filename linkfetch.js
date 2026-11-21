/**
 * 外部链接抓取：把用户贴进来的网页地址取回正文，供设定/剧本/聊天使用。
 * 只接受 http / https，限制体积与长度，避免把提示词撑爆。
 */
const http = require("node:http");
const https = require("node:https");
const zlib = require("node:zlib");

const MAX_BYTES = 400 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15000;
const MAX_TEXT_PER_LINK = 4000;
const MAX_TOTAL_CHARS = 8000;
const MAX_LINKS = 5;

function decodeBody(buffer, contentType) {
  const head = buffer.subarray(0, 4096).toString("latin1");
  let charset = (String(contentType).match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!charset) charset = (head.match(/charset=["']?([\w-]+)/i) || [])[1];
  charset = String(charset || "utf-8").toLowerCase().trim();
  const alias = { gb2312: "gb18030", gbk: "gb18030", "utf8": "utf-8", big5: "big5", "x-sjis": "shift_jis" };
  const name = alias[charset] || charset;
  try {
    return new TextDecoder(name).decode(buffer);
  } catch {
    try {
      return new TextDecoder("utf-8").decode(buffer);
    } catch {
      return buffer.toString("utf8");
    }
  }
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|section|article|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return n > 31 && n < 65536 ? String.fromCharCode(n) : " ";
    })
    .replace(/[ \t\u00a0\u3000]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pageTitle(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]).slice(0, 80) : "";
}

function decompress(buffer, encoding) {
  const enc = String(encoding || "").toLowerCase();
  try {
    if (enc.includes("br")) return zlib.brotliDecompressSync(buffer);
    if (enc.includes("gzip")) return zlib.gunzipSync(buffer);
    if (enc.includes("deflate")) return zlib.inflateSync(buffer);
  } catch {}
  return buffer;
}

function normalizeUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("链接是空的");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("这不是一个有效的网址");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只支持 http / https 开头的网址");
  }
  return url;
}

function requestOnce(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(
      url,
      {
        timeout: TIMEOUT_MS,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error("跳转次数太多"));
            return;
          }
          let next;
          try {
            next = new URL(res.headers.location, url);
          } catch {
            reject(new Error("跳转地址无效"));
            return;
          }
          requestOnce(next, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (status >= 400) {
          res.resume();
          reject(new Error(`对方返回 ${status}`));
          return;
        }
        const chunks = [];
        let size = 0;
        let truncated = false;
        res.on("data", (chunk) => {
          if (truncated) return;
          size += chunk.length;
          if (size > MAX_BYTES) {
            truncated = true;
            chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (size - MAX_BYTES))));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("close", () => {
          const raw = decompress(Buffer.concat(chunks), res.headers["content-encoding"]);
          const contentType = res.headers["content-type"] || "";
          const body = decodeBody(raw, contentType);
          const isHtml = /html|xml/i.test(contentType) || /^\s*</.test(body);
          const text = isHtml ? htmlToText(body) : body.trim();
          resolve({
            finalUrl: url.href,
            title: isHtml ? pageTitle(body) : "",
            text,
            truncated,
          });
        });
        res.on("error", reject);
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("请求超时"));
    });
    req.on("error", reject);
  });
}

async function fetchLink(rawUrl) {
  const url = normalizeUrl(rawUrl);
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const page = await requestOnce(url, MAX_REDIRECTS);
      const clipped = page.text.length > MAX_TEXT_PER_LINK;
      const text = clipped ? `${page.text.slice(0, MAX_TEXT_PER_LINK)}…（后略）` : page.text;
      if (!text.trim()) throw new Error("页面里没有可用的文字");
      return {
        url: url.href,
        title: page.title || url.hostname,
        text,
        chars: text.length,
        truncated: clipped || page.truncated,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      lastError = err;
      const message = String(err?.message || err);
      const retriable =
        /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EPIPE|socket hang up|请求超时|对方返回 5\d\d/.test(message);
      if (!retriable || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastError || new Error("抓取失败");
}

/** 批量抓取，超出数量的直接忽略。 */
async function fetchLinks(urls) {
  const list = (Array.isArray(urls) ? urls : [])
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .slice(0, MAX_LINKS);
  const out = [];
  for (const url of list) {
    try {
      out.push(await fetchLink(url));
    } catch (err) {
      out.push({ url, ok: false, error: String(err.message || err) });
    }
  }
  return out.filter((x) => x.ok !== false).concat(out.filter((x) => x.ok === false).map((x) => ({ ...x, ok: false })));
}

/** 把已保存的链接整理成提示词里的一段，超长直接截断。 */
function linksToPromptBlock(links) {
  const list = (Array.isArray(links) ? links : []).filter((l) => l && l.text);
  if (!list.length) return "";
  let total = 0;
  const parts = [];
  for (const link of list.slice(0, MAX_LINKS)) {
    const remain = MAX_TOTAL_CHARS - total;
    if (remain <= 200) break;
    const text = link.text.length > remain ? `${link.text.slice(0, remain)}…（后略）` : link.text;
    total += text.length;
    parts.push(`◆ ${link.title || link.url}\n来源：${link.url}\n${text}`);
  }
  return parts.join("\n\n");
}

module.exports = {
  fetchLink,
  fetchLinks,
  linksToPromptBlock,
  htmlToText,
  normalizeUrl,
  MAX_TEXT_PER_LINK,
  MAX_TOTAL_CHARS,
  MAX_LINKS,
};
