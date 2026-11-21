#!/usr/bin/env node
/**
 * 生成一个别人也能打开的公网试玩链接（Cloudflare 快速隧道）。
 * 关掉这个窗口就停止分享；链接每次启动都会变。
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = __dirname;
const WORK = path.join(ROOT, "work");
const CF = path.join(ROOT, "bin", "cloudflared.exe");
const LINK_FILE = path.join(WORK, "share-link.txt");
const PID_FILE = path.join(WORK, "cloudflared.pid");
const SHARE_PID_FILE = path.join(WORK, "share.pid");

const config = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  } catch {
    return {};
  }
})();

const PORT = Number(config.port) || 8890;
const KEY = String(config.shareKey || "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/ping", timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureServer() {
  if (await ping()) return true;
  console.log("本地服务没在跑，先把它拉起来…");
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 40; i += 1) {
    await sleep(250);
    if (await ping()) return true;
  }
  return false;
}

function banner(url) {
  const line = "═".repeat(58);
  console.log(`\n${line}`);
  console.log("  公网试玩链接（直接复制发给别人）");
  console.log("");
  console.log(`  ${url}`);
  console.log("");
  console.log("  · 每个人打开都是自己的存档，互不影响");
  console.log(`  · 每位访客最多 ${config.guestTurnLimit || 60} 回合`);
  console.log("  · 关掉这个窗口 = 停止分享，链接立即失效");
  console.log(`${line}\n`);
}

async function main() {
  if (!fs.existsSync(CF)) {
    console.error("找不到 bin\\cloudflared.exe，请重新下载后再试。");
    process.exit(1);
  }
  const ok = await ensureServer();
  if (!ok) {
    console.error(`本地服务（端口 ${PORT}）没有起来，先双击启动跑团再分享。`);
    process.exit(1);
  }

  try {
    fs.writeFileSync(SHARE_PID_FILE, String(process.pid));
  } catch {}

  let stopping = false;
  let child = null;

  const launch = () => {
    if (stopping) return;
    console.log("正在建立公网隧道，通常 5 到 20 秒…");
    child = spawn(
      CF,
      ["tunnel", "--url", `http://127.0.0.1:${PORT}`, "--no-autoupdate", "--protocol", "http2", "--edge-ip-version", "4"],
      { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );

    try {
      fs.writeFileSync(PID_FILE, String(child.pid));
    } catch {}

    let sawUrl = false;
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const m = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !sawUrl) {
        sawUrl = true;
        const url = KEY ? `${m[0]}/?k=${encodeURIComponent(KEY)}` : `${m[0]}/`;
        try {
          fs.writeFileSync(
            LINK_FILE,
            `${url}\n生成时间：${new Date().toLocaleString("zh-CN")}\n（关掉分享窗口后失效）\n`,
            "utf8"
          );
        } catch {}
        banner(url);
      }
      if (sawUrl && /Registered tunnel connection/.test(buffer)) {
        console.log("隧道已就绪，可以把上面的链接发出去了。\n");
        buffer = "";
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (stopping) return;
      console.log(`隧道断开（代码 ${code}），5 秒后自动重连；重连后链接会变。`);
      setTimeout(launch, 5000);
    });
  };

  launch();

  const shutdown = () => {
    stopping = true;
    try {
      child.kill();
    } catch {}
    try {
      fs.unlinkSync(PID_FILE);
      fs.unlinkSync(SHARE_PID_FILE);
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);

}

main();
