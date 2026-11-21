#!/usr/bin/env node
/** 启动器：后台拉起跑团服务，等服务就绪后打开浏览器。 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = __dirname;
const WORK = path.join(ROOT, "work");
const STATE_FILE = path.join(WORK, "server.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/ping", timeout: 900 }, (res) => {
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

function openBrowser(url) {
  const child = spawn("cmd.exe", ["/c", "start", "", url], { windowsHide: true, stdio: "ignore" });
  child.on("error", () => {});
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const existing = readState();
  if (existing && (await ping(existing.port))) {
    console.log(`跑团面板已经在运行：${existing.url}`);
    openBrowser(existing.url);
    return;
  }
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 40; i += 1) {
    await sleep(250);
    const state = readState();
    if (state && (await ping(state.port))) {
      console.log(`跑团面板已启动：${state.url}`);
      openBrowser(state.url);
      return;
    }
  }
  console.error("启动超时：服务没能起来。");
  process.exitCode = 1;
})();
