#!/usr/bin/env node
/** 停止跑团服务。 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const STATE_FILE = path.join(__dirname, "work", "server.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function quit(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/quit", method: "POST", timeout: 1200 },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

(async () => {
  const state = readState();
  if (!state) return console.log("没找到运行记录，跑团服务应该没在跑。");
  await quit(state.port);
  await new Promise((r) => setTimeout(r, 800));
  try {
    process.kill(state.pid);
  } catch {}
  console.log("已停止跑团服务。");
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  } catch {}
})();
