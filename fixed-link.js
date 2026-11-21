#!/usr/bin/env node
/**
 * 固定公网域名（ngrok 免费静态域名）。
 * 需要先运行「设置ngrok令牌.bat」保存 authtoken。
 * 域名固定，重连后地址不变。
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

const ROOT = __dirname;
const WORK = path.join(ROOT, "work");
const NGROK = path.join(ROOT, "bin", "ngrok.exe");
const LINK_FILE = path.join(WORK, "fixed-link.txt");
const DOMAIN_FILE = path.join(WORK, "fixed-domain.txt");
const PID_FILE = path.join(WORK, "ngrok.pid");
const FIX_PID_FILE = path.join(WORK, "fixed.pid");

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

function runNgrok(args) {
  return execFileSync(NGROK, args, { cwd: ROOT, encoding: "utf8", timeout: 30000, windowsHide: true });
}

function hasToken() {
  try {
    runNgrok(["config", "check"]);
    return true;
  } catch {
    return false;
  }
}

function findDomain() {
  try {
    const saved = fs.readFileSync(DOMAIN_FILE, "utf8").trim();
    if (saved) return saved;
  } catch {}
  try {
    const raw = runNgrok(["api", "reserved-domains", "list"]);
    const data = JSON.parse(raw);
    const hit = (data.domains || []).find((d) => d && d.domain && !d.domain.includes(".ngrok-free.dev--"));
    if (hit) return hit.domain;
  } catch {}
  return "";
}

function banner(link, domain) {
  const line = "═".repeat(58);
  console.log(`\n${line}`);
  console.log("  固定公网链接（永久地址，重连也不变）");
  console.log("");
  console.log(`  ${link}`);
  console.log("");
  console.log(`  域名：${domain}（绑定到本机的 ${PORT} 端口）`);
  console.log(`  每位访客最多 ${config.guestTurnLimit || 800} 回合，人数不限`);
  console.log("  关掉这个窗口 = 停止固定域名");
  console.log(`${line}\n`);
}

async function main() {
  try {
    const old = Number(fs.readFileSync(FIX_PID_FILE, "utf8").trim());
    if (old && old !== process.pid) {
      try {
        process.kill(old, 0);
        const raw = execFileSync("wmic", ["process", "where", `ProcessId=${old}`, "get", "CommandLine", "/value"], {
          encoding: "utf8",
          windowsHide: true,
        });
        if (raw.includes("fixed-link.js")) {
          console.log(`已经有一个固定域名进程在运行（PID ${old}），不要重复启动。`);
          console.log("如需重启，先双击「停止固定域名.bat」。");
          try {
            const link = fs.readFileSync(LINK_FILE, "utf8").split(/\r?\n/)[0];
            if (link) console.log(`当前链接：${link}`);
          } catch {}
          process.exit(0);
        }
      } catch {}
    }
    fs.writeFileSync(FIX_PID_FILE, String(process.pid));
  } catch {}
  if (!fs.existsSync(NGROK)) {
    console.error("找不到 bin\\ngrok.exe，请重新安装。");
    process.exit(1);
  }
  if (!hasToken()) {
    console.error("\n还没有配置 ngrok 令牌。");
    console.error("1. 打开 https://dashboard.ngrok.com/signup 免费注册（用邮箱即可）");
    console.error("2. 登录后在 Getting Started → Your Authtoken 复制令牌");
    console.error("3. 双击本目录的「设置ngrok令牌.bat」，粘贴令牌并回车");
    console.error("4. 再双击「固定域名.bat」，地址就会固定下来\n");
    process.exit(1);
  }
  const ok = await ensureServer();
  if (!ok) {
    console.error(`本地服务（端口 ${PORT}）没有起来，先双击启动跑团。`);
    process.exit(1);
  }
  const domain = findDomain();
  if (!domain) {
    console.error("\n你的 ngrok 账号里还没有静态域名。");
    console.error("登录 https://dashboard.ngrok.com/domains ，点 Create Domain 领一个免费的静态域名");
    console.error("（形如 xxxx.ngrok-free.app），然后把域名填进 work\\fixed-domain.txt 再运行本脚本。\n");
    process.exit(1);
  }

  let stopping = false;
  let child = null;
  const launch = () => {
    if (stopping) return;
    console.log(`正在用固定域名 ${domain} 建立隧道…`);
    child = spawn(
      NGROK,
      ["http", String(PORT), `--domain=${domain}`, "--log=stdout", "--log-format=json"],
      { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    try {
      fs.writeFileSync(PID_FILE, String(child.pid));
    } catch {}

    let buffer = "";
    let printed = false;
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (/ERR_NGROK|error|failed|reconnect/i.test(line)) {
          const msg = line.match(/"msg":"([^"]+)"/);
          if (msg) console.log("ngrok: " + msg[1]);
        }
        const m = line.match(/"url":"(https:\/\/[^"]+)"/);
        if (!m || printed) continue;
        printed = true;
        const base = m[1].replace(/\/$/, "");
        const link = KEY ? `${base}/?k=${encodeURIComponent(KEY)}` : `${base}/`;
        try {
          fs.writeFileSync(
            LINK_FILE,
            `${link}\n生成时间：${new Date().toLocaleString("zh-CN")}\n（固定域名，重连不变；关掉窗口才失效）\n`,
            "utf8"
          );
          fs.writeFileSync(DOMAIN_FILE, domain, "utf8");
        } catch {}
        banner(link, domain);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (stopping) return;
      console.log(`隧道断开（代码 ${code}），5 秒后用同一域名重连…`);
      setTimeout(launch, 5000);
    });
  };
  launch();

  const shutdown = () => {
    stopping = true;
    try {
      child.kill();
      fs.unlinkSync(PID_FILE);
      fs.unlinkSync(FIX_PID_FILE);
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
}

main();
