/* 跑团面板前端 */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

let meta = null;
let session = null;
let busy = false;

const setupState = {
  scenarioId: null,
  difficulty: "normal",
  attrs: {},
  editingId: null,
};

/* ---------- 开局界面 ---------- */

const PAGE_SIZE = 4;
let scFilter = "all";
let scPage = 0;

function scenarioSeries(s) {
  const genre = String(s.genre || "");
  if (/^dc-/i.test(s.id) || /DC/i.test(genre)) return "dc";
  if (/^marvel-/i.test(s.id) || /Marvel|漫威/i.test(genre)) return "marvel";
  return "original";
}

function filteredScenarios() {
  const all = meta.scenarios || [];
  return scFilter === "all" ? all : all.filter((s) => scenarioSeries(s) === scFilter);
}

function renderScenarioTabs() {
  const box = $("scenario-tabs");
  if (!box) return;
  box.innerHTML = "";
  const tabs = [
    ["all", "全部"],
    ["original", "原创"],
    ["dc", "DC"],
    ["marvel", "漫威"],
  ];
  for (const [key, label] of tabs) {
    const b = el("button", scFilter === key ? "on" : "", label);
    b.addEventListener("click", () => {
      if (scFilter === key) return;
      scFilter = key;
      scPage = 0;
      setupState.scenarioId = null;
      renderScenarios();
    });
    box.appendChild(b);
  }
}

function renderScenarios(selectId) {
  renderScenarioTabs();
  if (selectId && !filteredScenarios().some((s) => s.id === selectId)) {
    scFilter = "all";
    renderScenarioTabs();
  }
  const list = filteredScenarios();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (selectId) {
    const idx = list.findIndex((s) => s.id === selectId);
    if (idx >= 0) scPage = Math.floor(idx / PAGE_SIZE);
  }
  scPage = Math.max(0, Math.min(pages - 1, scPage));
  const slice = list.slice(scPage * PAGE_SIZE, scPage * PAGE_SIZE + PAGE_SIZE);

  const box = $("scenarios");
  box.innerHTML = "";
  for (const s of slice) {
    const card = el("button", "card");
    card.appendChild(el("div", "t", s.title));
    card.appendChild(
      el("div", "g", `${s.genre} · ${s.scheduleCount} 个日程节点${s.hasOpening ? " · 已写开场白" : ""}${s.editable ? " · 可编辑" : ""}`)
    );
    card.appendChild(el("div", "b", s.blurb));
    card.addEventListener("click", () => {
      setupState.scenarioId = s.id;
      setupState.editingId = s.editable ? s.id : null;
      [...box.children].forEach((c) => c.classList.remove("on"));
      card.classList.add("on");
      const editable = Boolean(s.editable);
      $("btn-edit-scenario").classList.toggle("hidden", !editable);
      $("btn-del-scenario").classList.toggle("hidden", !editable);
      $("btn-share-scenario").classList.toggle("hidden", !editable);
    });
    box.appendChild(card);
  }

  const keep = slice.find((s) => s.id === setupState.scenarioId);
  if (keep) {
    [...box.children][slice.indexOf(keep)]?.click();
  } else if (slice.length) {
    box.firstChild.click();
  } else {
    setupState.scenarioId = null;
    $("btn-edit-scenario").classList.add("hidden");
    $("btn-del-scenario").classList.add("hidden");
    $("btn-share-scenario").classList.add("hidden");
  }

  $("sc-page").textContent = `第 ${scPage + 1} / ${pages} 页`;
  $("sc-prev").disabled = scPage <= 0;
  $("sc-next").disabled = scPage >= pages - 1;
}

$("sc-prev").addEventListener("click", () => {
  if (scPage > 0) {
    scPage -= 1;
    renderScenarios();
  }
});
$("sc-next").addEventListener("click", () => {
  scPage += 1;
  renderScenarios();
});
document.addEventListener("keydown", (e) => {
  if ($("setup")?.classList.contains("hidden")) return;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  if (e.key === "ArrowLeft" && !$("sc-prev").disabled) $("sc-prev").click();
  if (e.key === "ArrowRight" && !$("sc-next").disabled) $("sc-next").click();
});

function renderDiffs() {
  const box = $("diffs");
  box.innerHTML = "";
  for (const [key, d] of Object.entries(meta.difficulty)) {
    const card = el("button", "card");
    card.appendChild(el("div", "t", d.label));
    card.appendChild(el("div", "b", d.hint));
    card.addEventListener("click", () => {
      setupState.difficulty = key;
      [...box.children].forEach((c) => c.classList.remove("on"));
      card.classList.add("on");
      updateDerived();
    });
    box.appendChild(card);
    if (key === "normal") setTimeout(() => card.click(), 0);
  }
}

function renderAttrs() {
  const box = $("attrs");
  box.innerHTML = "";
  for (const a of meta.attrs) {
    if (setupState.attrs[a.key] === undefined) setupState.attrs[a.key] = 5;
    const row = el("div", "attr-row");
    row.appendChild(el("div", "attr-name", a.label));
    row.appendChild(el("div", "attr-desc", a.desc));
    const val = el("div", "attr-val", String(setupState.attrs[a.key]));
    const minus = el("button", "", "−");
    const plus = el("button", "", "+");
    minus.addEventListener("click", () => change(a.key, -1, val));
    plus.addEventListener("click", () => change(a.key, 1, val));
    row.appendChild(val);
    row.appendChild(minus);
    row.appendChild(plus);
    box.appendChild(row);
  }
  updatePool();
}

function totalPoints() {
  return Object.values(setupState.attrs).reduce((a, b) => a + b, 0);
}

function change(key, delta, valNode) {
  const cur = setupState.attrs[key];
  const next = Math.max(meta.attrMin, Math.min(meta.attrMax, cur + delta));
  if (next === cur) return;
  if (delta > 0 && totalPoints() >= meta.attrPoints) return;
  setupState.attrs[key] = next;
  valNode.textContent = String(next);
  updatePool();
}

function updatePool() {
  const used = totalPoints();
  const left = meta.attrPoints - used;
  const pool = $("pool");
  pool.innerHTML = `已分配 <b>${used}</b> / ${meta.attrPoints} 点，剩余 <b>${left}</b> 点`;
  pool.classList.toggle("over", left < 0);
  $("start").disabled = left < 0 || left > 6;
  $("startHint").textContent = left > 6 ? "属性点还要用掉一些（最多可以留 6 点不用）" : "";
  updateDerived();
}

function updateDerived() {
  const diff = meta.difficulty[setupState.difficulty] || { hpShift: 0, sanShift: 0, label: "" };
  const a = setupState.attrs;
  const hp = 18 + (a.con || 5) * 2 + diff.hpShift;
  const san = 18 + (a.int || 5) + (a.per || 5) + diff.sanShift;
  $("derived").textContent = `${diff.label}难度下：初始生命 ${hp}，初始理智 ${san}。技能判定＝d20＋对应属性，对比如上难度。`;
}

/* ---------- 开局/继续 ---------- */

async function loadMeta() {
  const res = await fetch("/api/meta");
  meta = await res.json();
  renderScenarios();
  renderDiffs();
  renderAttrs();
  renderPresets();
  fillSettings();
  for (const name of meta.narrativeLengths || []) {
    const opt = el("option", "", `${name}篇幅`);
    opt.value = name;
    $("set-length").appendChild(opt);
  }
  for (const s of meta.skills) {
    const opt = el("option", "", `${s.name}（${meta.attrs.find((a) => a.key === s.attr).label}）`);
    opt.value = s.name;
    $("roll-skill").appendChild(opt);
  }
  if (meta.hasSave) {
    $("resume").classList.remove("hidden");
    $("resume").addEventListener("click", async () => {
      const r = await fetch("/api/state");
      const data = await r.json();
      if (data.session) {
        session = data.session;
        $("setup").classList.add("hidden");
        $("game").classList.add("on");
        renderSession();
        session.log.forEach((entry) => appendSegment(entry, true));
        scrollLog();
      }
    });
  }

  if (meta.isOwner === false) {
    $("btn-quit").classList.add("hidden");
    $("settings-sect")?.classList.add("hidden");
    const sub = document.querySelector(".setup-sub");
    if (sub) {
      sub.insertAdjacentHTML(
        "beforeend",
        `<div style="margin-top:8px;color:#c8a06a">你是访客：这一局最多 ${meta.guestTurnLimit || 60} 回合，进度只保存在你自己的浏览器里。</div>`
      );
    }
  }

  if (meta.isOwner === true && meta.siteOpen === false) {
    const bar = document.createElement("div");
    bar.className = "owner-closed-banner";
    bar.textContent = "入口已关闭：你是房主所以仍可进入，访客会看到“今日暂停营业”。";
    document.body.prepend(bar);
  }
}

async function startGame() {
  $("err").textContent = "";
  const character = {
    name: $("c-name").value,
    gender: $("c-gender").value,
    age: $("c-age").value,
    role: $("c-role").value,
    appearance: $("c-appearance").value,
    personality: $("c-personality").value,
    background: $("c-background").value,
    goal: $("c-goal").value,
    attrs: setupState.attrs,
  };
  if (!character.name.trim()) {
    $("err").textContent = "先给角色起个名字。";
    return;
  }
  $("start").disabled = true;
  $("start").textContent = "正在开幕…";
  try {
    const res = await fetch("/api/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        character,
        scenarioId: setupState.scenarioId,
        difficulty: setupState.difficulty,
        mode: $("mode-select")?.value || "trpg",
      }),
    });
    const data = await res.json();
    if (data.error) {
      $("err").textContent = data.error;
      return;
    }
    session = data.session;
    $("setup").classList.add("hidden");
    $("game").classList.add("on");
    $("log").innerHTML = "";
    renderSession();
    appendSegment({ type: "sys", text: `${session.scenario.title} · ${meta.difficulty[session.difficulty].label}难度 · 游戏开始` }, true);
    (data.segments || []).forEach(appendSegment);
    scrollLog();
    showOpening();
  } catch (e) {
    $("err").textContent = "启动失败：" + e.message;
  } finally {
    $("start").disabled = false;
    $("start").textContent = "开始游戏";
  }
}

/* ---------- 游戏界面 ---------- */

function appendSegment(seg, silent) {
  const log = $("log");
  const row = el("div", `seg ${seg.type === "change" ? "change" : seg.type}`);
  if (seg.type === "player") {
    row.appendChild(el("div", "b", seg.text));
  } else if (seg.type === "gm") {
    row.textContent = seg.text;
  } else {
    const cls = seg.type === "dice" ? `b ${seg.grade === "失败" || seg.grade === "大失败" ? "lose" : "win"}` : "b";
    row.appendChild(el("div", cls, seg.text));
  }
  log.appendChild(row);
  if (!silent) scrollLog();
}

let stickToBottom = true;

function nearBottom() {
  const log = $("log");
  return log.scrollHeight - log.scrollTop - log.clientHeight < 140;
}

function showJump(on) {
  const b = $("jump-latest");
  if (b) b.classList.toggle("hidden", !on);
}

function scrollLog(force) {
  const log = $("log");
  if (force || stickToBottom) {
    log.scrollTop = log.scrollHeight;
    showJump(false);
  }
}

$("log").addEventListener("scroll", () => {
  stickToBottom = nearBottom();
  showJump(!stickToBottom);
});

$("jump-latest").addEventListener("click", () => {
  stickToBottom = true;
  scrollLog(true);
});

function statBar(sel, value, max) {
  $(sel + "-text").textContent = `${value} / ${max}`;
  $(sel + "-fill").style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
}

function renderSession() {
  if (!session) return;
  const c = session.character;
  $("pc-name").textContent = c.name;
  $("pc-sub").textContent = [c.gender, c.age ? `${c.age} 岁` : "", c.role].filter(Boolean).join(" · ");
  statBar("hp", session.status.hp, session.status.hpMax);
  statBar("san", session.status.san, session.status.sanMax);
  $("money").textContent = String(session.status.money);
  $("turns").textContent = `${session.turns || 0} 回合`;

  const attrBox = $("attr-list");
  attrBox.innerHTML = "";
  for (const a of meta.attrs) {
    const row = el("div", "kv");
    row.appendChild(el("span", "", a.label));
    row.appendChild(el("span", "", String(c.attrs[a.key])));
    attrBox.appendChild(row);
  }

  const skillBox = $("skill-list");
  skillBox.innerHTML = "";
  for (const s of meta.skills) {
    skillBox.appendChild(el("span", "tag", `${s.name} ${c.attrs[s.attr]}`));
  }

  const g0 = session.growth || { xp: 0, level: 1 };
  $("p-location").textContent = session.location || "未记录";
  $("p-level").textContent = String(g0.level || 1);
  $("p-xp").textContent = String(g0.xp || 0);
  const qbox = $("p-quests");
  qbox.innerHTML = "";
  for (const q of session.quests || []) {
    qbox.appendChild(el("span", "tag" + (q.done ? " done" : ""), q.text));
  }
  const nbox = $("p-npcs");
  nbox.innerHTML = "";
  for (const n of session.npcsKnown || []) nbox.appendChild(el("span", "tag", n));

  const inv = $("inventory");
  inv.innerHTML = "";
  (session.inventory.length ? session.inventory : ["（空）"]).forEach((i) => inv.appendChild(el("span", "tag", i)));

  const clues = $("clues");
  clues.innerHTML = "";
  (session.clues.length ? session.clues : ["（还没有线索）"]).forEach((i) => clues.appendChild(el("span", "tag clue", i)));

  const sched = $("schedule");
  sched.innerHTML = "";
  const upcomingKeys = new Set((session.upcoming || []).map((u) => u.key));
  const nextKey = (session.upcoming || [])[0]?.key;
  for (const ev of session.schedule || []) {
    const h = Math.floor(ev.minute / 60);
    const m = ev.minute % 60;
    const row = el("div", "row" + (ev.fired ? " done" : upcomingKeys.has(ev.key) ? (ev.key === nextKey ? " next" : "") : ""));
    row.appendChild(el("div", "when", `第 ${ev.day} 天 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}${ev.fired ? " · 已发生" : ""}`));
    row.appendChild(el("div", "", ev.title));
    sched.appendChild(row);
  }

  const rel = $("relations");
  rel.innerHTML = "";
  const relEntries = Object.entries(session.relations || {});
  if (!relEntries.length) rel.appendChild(el("div", "hint", "（还没跟谁打过交道）"));
  relEntries.sort((a, b) => (b[1].updatedTurn || 0) - (a[1].updatedTurn || 0));
  for (const [name, r] of relEntries) {
    const row = el("div", "rel-row");
    const head = el("div", "rel-head");
    head.appendChild(el("div", "rel-name", name));
    const value = Number(r.value) || 0;
    head.appendChild(el("div", `rel-attitude${value > 0 ? " up" : value < 0 ? " down" : ""}`, r.attitude || "未定"));
    row.appendChild(head);
    if (r.note) row.appendChild(el("div", "rel-note", r.note));
    const meter = el("div", "rel-meter");
    const fill = el("div", "fill");
    fill.style.width = `${Math.round(((value + 10) / 20) * 100)}%`;
    meter.appendChild(fill);
    row.appendChild(meter);
    rel.appendChild(row);
  }

  const obj = $("objectives");
  obj.innerHTML = "";
  const objectives = session.objectives || [];
  if (!objectives.length) obj.appendChild(el("div", "hint", "（还没有明确目标）"));
  for (const o of objectives) {
    const row = el("div", `obj-row${o.done ? " done" : ""}`);
    row.appendChild(el("span", "obj-dot", o.done ? "✓" : "•"));
    row.appendChild(el("span", "", o.text));
    obj.appendChild(row);
  }

  const evBox = $("eventlog");
  evBox.innerHTML = "";
  const events = (session.eventLog || []).slice(-8).reverse();
  if (!events.length) evBox.appendChild(el("div", "hint", "（还没有触发事件）"));
  for (const e of events) {
    const row = el("div", "row done");
    row.appendChild(el("div", "when", e.at || `第 ${e.day} 天`));
    row.appendChild(el("div", "", e.title));
    evBox.appendChild(row);
  }

  $("tb-title").textContent = `${session.scenario.title} · ${c.name}${session.mode === "free" ? " · 自由叙事" : ""}`;
  $("tb-clock").textContent = session.clock;

  if (session.ended) showEnding(session.ended);
}

function showEnding(name) {
  if ($("log").querySelector(".ending")) return;
  const banner = el("div", "ending", `—— 结局：${name} ——`);
  $("log").appendChild(banner);
  $("input").disabled = true;
  $("send").disabled = true;
  $("input").placeholder = "故事已经结束，点右上角「重新开始」再来一局。";
  appendSegment({ type: "sys", text: "这一局结束了。可以点右上角「重新开始」，换个角色或换个剧本。", silent: true });
  scrollLog();
}

function setBusy(on, note) {
  busy = on;
  $("send").disabled = on || Boolean(session?.ended);
  $("input").disabled = on || Boolean(session?.ended);
  if (note) {
    if (on) {
      const row = el("div", "seg gm busy", note);
      row.id = "thinking";
      $("log").appendChild(row);
      scrollLog();
    } else {
      $("thinking")?.remove();
    }
  }
}

async function act(text) {
  if (!text.trim() || busy || session?.ended) return;
  stickToBottom = true;
  appendSegment({ type: "player", text });
  $("input").value = "";
  $("input").style.height = "";
  setBusy(true, "……");
  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.error) {
      appendSegment({ type: "sys", text: data.error });
      return;
    }
    session = data.session;
    (data.segments || []).forEach(appendSegment);
    renderSession();
  } catch (e) {
    setBusy(false);
    appendSegment({ type: "sys", text: "请求失败：" + e.message });
  }
}

/* ---------- 事件绑定 ---------- */

$("start").addEventListener("click", startGame);

$("send").addEventListener("click", () => act($("input").value));

$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    act($("input").value);
  }
});

$("input").addEventListener("input", () => {
  $("input").style.height = "auto";
  $("input").style.height = Math.min($("input").scrollHeight, 180) + "px";
});

for (const b of document.querySelectorAll("#quick button")) {
  b.addEventListener("click", () => act(b.dataset.q));
}

$("roll-btn").addEventListener("click", async () => {
  if (!session || busy) return;
  const skill = $("roll-skill").value;
  const dc = $("roll-dc").value;
  const res = await fetch("/api/roll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ skill, dc }),
  });
  const data = await res.json();
  if (data.error) return appendSegment({ type: "sys", text: data.error });
  session = data.session;
  (data.segments || []).forEach(appendSegment);
});

$("btn-new").addEventListener("click", async () => {
  if (!confirm("重新开始会清掉当前进度（存档也会一并删掉），确定吗？")) return;
  await fetch("/api/reset", { method: "POST" });
  location.reload();
});

$("btn-quit").addEventListener("click", async () => {
  if (!confirm("退出后要重新双击桌面快捷方式才能继续，确定退出？")) return;
  try {
    await fetch("/api/quit", { method: "POST" });
  } catch {}
  $("log").innerHTML = "";
  appendSegment({ type: "sys", text: "已经退出了。想继续就再双击一次桌面的跑团快捷方式（进度还在）。" });
});

/* ---------- 本机存档 / 读档 ---------- */

function showSession(sess) {
  session = sess;
  $("setup").classList.add("hidden");
  $("game").classList.add("on");
  $("log").innerHTML = "";
  renderSession();
  (session.log || []).forEach((entry) => appendSegment(entry, true));
  stickToBottom = true;
  scrollLog(true);
}

$("btn-save-file").addEventListener("click", async () => {
  try {
    const r = await fetch("/api/state");
    const data = await r.json();
    if (!data.session) {
      alert("当前还没有进行中的游戏。");
      return;
    }
    const payload = {
      format: "paotuan-save",
      version: 1,
      savedAt: new Date().toISOString(),
      session: data.session,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const name = data.session.character?.name || "角色";
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `跑团存档-${name}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch {
    alert("导出存档失败。");
  }
});

$("btn-load-file").addEventListener("click", () => $("save-file-input").click());

$("save-file-input").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!confirm("读取存档会覆盖当前进行中的进度，继续吗？")) return;
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    alert("这个文件不是有效的 JSON。");
    return;
  }
  const sess = payload.session || payload;
  try {
    const r = await fetch("/api/save/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sess }),
    });
    const data = await r.json();
    if (!r.ok) {
      alert(data.error || "读档失败");
      return;
    }
    showSession(data.session);
  } catch {
    alert("读档请求失败。");
  }
});

/* ---------- 开局面板 ---------- */

function showOpening() {
  if (!session) {
    alert("还没有开始游戏。");
    return;
  }
  const c = session.character || {};
  const sc = session.scenario || {};
  const attrs = [
    ["str", "力量"], ["dex", "敏捷"], ["con", "体质"],
    ["int", "智力"], ["per", "感知"], ["cha", "魅力"],
  ].map(([k, label]) => `<span class="op-attr">${label} ${c.attrs?.[k] ?? "-"}</span>`).join("");
  const opening = session.opening || (session.log || []).find((e) => e.type === "gm")?.text || "（还没有开场白）";
  const diff = meta?.difficulty?.[session.difficulty]?.label || "标准";
  $("op-title").textContent = `${sc.title || "剧本"} · 开场`;
  $("op-body").innerHTML =
    `<div class="op-meta">${escHtml(sc.genre || "")} · ${diff}难度 · ${session.mode === "free" ? "自由叙事" : "跑团规则"} · ${escHtml(session.clock || "")}</div>` +
    (sc.blurb ? `<div class="op-meta">${escHtml(sc.blurb)}</div>` : "") +
    `<div class="op-sec">你的角色</div>` +
    `<div>${escHtml(c.name || "无名旅人")}${c.role ? " · " + escHtml(c.role) : ""}</div>` +
    `<div class="op-attrs">${attrs}</div>` +
    `<div class="op-meta">随身：${(session.inventory || []).map(escHtml).join("、") || "空"}　生命 ${session.status?.hp}/${session.status?.hpMax}　理智 ${session.status?.san}/${session.status?.sanMax}</div>` +
    `<div class="op-meta">位置：${escHtml(session.location || "未记录")}　等级 ${session.growth?.level || 1}（${session.growth?.xp || 0} XP）</div>` +
    `<div class="op-sec">开场</div>` +
    `<div class="op-story">${escHtml(opening)}</div>`;
  $("opening-modal").classList.remove("hidden");
}

$("btn-opening").addEventListener("click", showOpening);
$("op-start").addEventListener("click", () => {
  $("opening-modal").classList.add("hidden");
  $("input")?.focus();
});

/* ---------- 顶部 HUD：在线人数 / 好评差评 / 留言板 ---------- */

let fbTimer = null;

function updateHud(data) {
  if (data.online != null) $("online-count").textContent = String(Math.max(1, data.online));
  if (data.up != null) $("vote-up-count").textContent = String(data.up);
  if (data.down != null) $("vote-down-count").textContent = String(data.down);
  if (data.mine !== undefined) {
    $("vote-up").classList.toggle("on", data.mine === "up");
    $("vote-down").classList.toggle("on", data.mine === "down");
  }
}

async function beat() {
  try {
    const r = await fetch("/api/presence", { method: "POST" });
    if (r.ok) updateHud(await r.json());
  } catch {}
}

async function castVote(value) {
  try {
    const r = await fetch("/api/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (r.ok) updateHud(await r.json());
  } catch {}
}

let fbPage = 1;
let fbPages = 1;

function fmtTime(value) {
  try {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function feedbackItem(m) {
  const item = document.createElement("div");
  item.className = "fb-item";

  const meta = document.createElement("div");
  meta.className = "fb-meta";
  const left = document.createElement("span");
  left.className = "fb-author";
  if (m.avatar) {
    const img = document.createElement("img");
    img.className = "fb-avatar";
    img.src = m.avatar;
    img.alt = "";
    left.appendChild(img);
  } else {
    const ph = document.createElement("span");
    ph.className = "fb-avatar ph";
    ph.textContent = (m.name || "匿").slice(0, 1);
    left.appendChild(ph);
  }
  const name = document.createElement("span");
  name.textContent = m.name || "匿名旅人";
  left.appendChild(name);
  const right = document.createElement("span");
  right.textContent = fmtTime(m.at) + (m.editedAt ? " · 已编辑" : "");
  meta.append(left, right);

  const text = document.createElement("div");
  text.className = "fb-text";
  text.textContent = m.text;
  item.append(meta, text);

  if (m.mine) {
    const tools = document.createElement("div");
    tools.className = "fb-tools";
    const edit = document.createElement("button");
    edit.textContent = "编辑";
    edit.addEventListener("click", async () => {
      const next = prompt("修改你的留言：", m.text);
      if (next == null) return;
      const value = next.trim();
      if (!value) return;
      const r = await fetch("/api/feedback/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: m.id, text: value }),
      });
      if (r.ok) loadFeedback();
      else {
        const d = await r.json();
        alert(d.error || "修改失败");
      }
    });
    const del = document.createElement("button");
    del.textContent = "删除";
    del.addEventListener("click", async () => {
      if (!confirm("确定删除这条留言？")) return;
      const r = await fetch("/api/feedback/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: m.id }),
      });
      if (r.ok) loadFeedback();
      else alert("删除失败");
    });
    tools.append(edit, del);
    item.appendChild(tools);
  }
  return item;
}

async function loadFeedback() {
  try {
    const r = await fetch(`/api/feedback?page=${fbPage}&size=8`);
    if (!r.ok) return;
    const data = await r.json();
    updateHud(data);
    fbPages = data.pages || 1;
    fbPage = data.page || 1;
    $("fb-count").textContent = String(data.total || 0);
    $("fb-page").textContent = `第 ${fbPage} / ${fbPages} 页`;
    $("fb-prev").disabled = fbPage <= 1;
    $("fb-next").disabled = fbPage >= fbPages;

    const list = $("fb-list");
    list.innerHTML = "";
    if (!data.messages || !data.messages.length) {
      const empty = document.createElement("div");
      empty.className = "fb-empty";
      empty.textContent = "还没有留言，来写第一条吧。";
      list.appendChild(empty);
      return;
    }
    for (const m of data.messages) list.appendChild(feedbackItem(m));
  } catch {}
}

function openFeedback() {
  $("fb-modal").classList.remove("hidden");
  loadFeedback();
  clearInterval(fbTimer);
  fbTimer = setInterval(loadFeedback, 5000);
}

function closeFeedback() {
  $("fb-modal").classList.add("hidden");
  clearInterval(fbTimer);
  fbTimer = null;
}

$("vote-up").addEventListener("click", () => castVote("up"));
$("vote-down").addEventListener("click", () => castVote("down"));
$("feedback-open").addEventListener("click", openFeedback);
$("fb-close").addEventListener("click", closeFeedback);
$("fb-modal").addEventListener("click", (e) => {
  if (e.target === $("fb-modal")) closeFeedback();
});
$("fb-send").addEventListener("click", async () => {
  const text = $("fb-text").value.trim();
  if (!text) {
    $("fb-status").textContent = "写点什么再发吧。";
    return;
  }
  $("fb-status").textContent = "发布中…";
  try {
    const r = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    if (!r.ok) {
      $("fb-status").textContent = data.error || "发布失败";
      return;
    }
    $("fb-text").value = "";
    $("fb-status").textContent = "已发布，所有人可见。";
    fbPage = 1;
    loadFeedback();
  } catch {
    $("fb-status").textContent = "网络不给力，稍后再试。";
  }
});

$("fb-prev").addEventListener("click", () => {
  if (fbPage > 1) {
    fbPage -= 1;
    loadFeedback();
  }
});

$("fb-next").addEventListener("click", () => {
  if (fbPage < fbPages) {
    fbPage += 1;
    loadFeedback();
  }
});

/* ---------- 网站主题 ---------- */

function applySiteTheme(value) {
  if (value === "pink" || value === "cream") document.documentElement.dataset.theme = value;
  else document.documentElement.removeAttribute("data-theme");
}

function markThemeButtons() {
  const current = me?.siteTheme || "dark";
  document.querySelectorAll("[data-site-theme]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.siteTheme === current);
  });
}

document.querySelectorAll("[data-site-theme]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const value = btn.dataset.siteTheme;
    applySiteTheme(value);
    me = { ...(me || {}), siteTheme: value };
    markThemeButtons();
    await saveMe();
  });
});

setInterval(beat, 1000);
beat();
loadFeedback();

/* ---------- 我的资料 ---------- */

let me = null;

async function loadMe() {
  try {
    const r = await fetch("/api/me");
    if (!r.ok) return;
    me = await r.json();
    $("me-name").value = me.name || "";
    $("me-bio").value = me.bio || "";
    $("me-theme").value = me.theme || "#c8a06a";
    const img = $("me-avatar-img");
    if (me.avatar) {
      img.src = me.avatar;
      img.classList.add("on");
    } else {
      img.classList.remove("on");
      img.removeAttribute("src");
    }
    applySiteTheme(me.siteTheme);
    markThemeButtons();
  } catch {}
}

async function saveMe() {
  const payload = {
    name: $("me-name").value,
    bio: $("me-bio").value,
    theme: $("me-theme").value,
    avatar: me?.avatar || "",
    siteTheme: me?.siteTheme || "dark",
  };
  const r = await fetch("/api/me", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (r.ok) {
    me = await r.json();
    $("me-status").textContent = "已保存";
    setTimeout(() => ($("me-status").textContent = ""), 2000);
  }
}

$("me-open").addEventListener("click", () => {
  $("me-modal").classList.remove("hidden");
  loadMe();
});

$("me-save").addEventListener("click", saveMe);

$("me-avatar-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    $("me-status").textContent = "头像不能超过 2MB";
    return;
  }
  $("me-status").textContent = "上传中…";
  const dataUrl = await new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(file);
  });
  const r = await fetch("/api/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: dataUrl, mime: file.type, avatar: true }),
  });
  const data = await r.json();
  if (!r.ok) {
    $("me-status").textContent = data.error || "上传失败";
    return;
  }
  me = { ...(me || {}), avatar: data.url };
  const img = $("me-avatar-img");
  img.src = data.url;
  img.classList.add("on");
  await saveMe();
  $("me-status").textContent = "头像已更新";
});

/* ---------- 创作社区 ---------- */

let cmFile = null;
let cmFilter = "all";
let cmPosts = [];

function renderCommunity(posts) {
  const list = $("cm-list");
  list.innerHTML = "";
  const filtered = posts.filter((p) => {
    if (cmFilter === "all") return true;
    if (cmFilter === "mine") return Boolean(p.pid && me && p.pid === me.pid);
    return (p.type || "post") === cmFilter;
  });
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "fb-empty";
    empty.textContent = cmFilter === "mine" ? "你还没有发布过作品。" : "这个分区还没有作品。";
    list.appendChild(empty);
    return;
  }
  for (const post of filtered) {
    const card = document.createElement("div");
    card.className = "cm-post";
    const head = document.createElement("div");
    head.className = "cm-head";
    if (post.avatar) {
      const img = document.createElement("img");
      img.src = post.avatar;
      img.alt = "";
      head.appendChild(img);
    }
    const n = document.createElement(post.pid ? "a" : "span");
    n.className = "n";
    n.textContent = post.author || "匿名旅人";
    if (post.pid) {
      n.href = "/space?u=" + encodeURIComponent(post.pid);
      n.target = "_blank";
      n.rel = "noopener";
    }
    const t = document.createElement("span");
    t.className = "t";
    try {
      t.textContent = new Date(post.at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {}
    head.append(n, t);
    card.appendChild(head);
    if (post.title) {
      const h = document.createElement("div");
      h.className = "cm-title";
      h.textContent = post.title;
      card.appendChild(h);
    }
    if (post.type === "scenario") {
      const badge = document.createElement("div");
      badge.className = "cm-scenario";
      const head2 = document.createElement("div");
      head2.className = "cm-scenario-head";
      const tag = document.createElement("span");
      tag.className = "cm-badge";
      tag.textContent = "剧本";
      const g = document.createElement("span");
      g.className = "cm-genre";
      g.textContent = post.genre || "";
      head2.append(tag, g);
      const blurb = document.createElement("div");
      blurb.className = "cm-text";
      blurb.textContent = post.blurb || post.text || "";
      const imp = document.createElement("button");
      imp.className = "cm-import";
      imp.textContent = "导入到我的剧本";
      imp.addEventListener("click", () => importScenario(post.id, post.title));
      badge.append(head2, blurb, imp);
      card.appendChild(badge);
    } else if (post.text) {
      const p = document.createElement("div");
      p.className = "cm-text";
      p.textContent = post.text;
      card.appendChild(p);
    }
    if (post.tags && post.tags.length) {
      const tags = document.createElement("div");
      tags.className = "cm-tags";
      for (const t of post.tags) tags.appendChild(el("span", "tag", t));
      card.appendChild(tags);
    }
    if (post.media && post.media.url) {
      const wrap = document.createElement("div");
      wrap.className = "cm-media";
      if (String(post.media.type || "").startsWith("video/")) {
        const v = document.createElement("video");
        v.src = post.media.url;
        v.controls = true;
        v.preload = "metadata";
        wrap.appendChild(v);
      } else {
        const img = document.createElement("img");
        img.src = post.media.url;
        img.alt = "";
        wrap.appendChild(img);
      }
      card.appendChild(wrap);
    }
    const like = document.createElement("button");
    like.className = "cm-like" + (post.liked ? " on" : "");
    like.textContent = "♥ " + (post.likes || 0);
    like.addEventListener("click", async () => {
      const r = await fetch("/api/community/like", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: post.id }),
      });
      if (r.ok) loadCommunity();
    });
    card.appendChild(like);
    const comments = document.createElement("div");
    comments.className = "cm-comments";
    for (const c of post.comments || []) {
      const row = document.createElement("div");
      row.className = "cm-comment";
      row.innerHTML = `<b>${escHtml(c.who || "匿名")}</b>：${escHtml(c.text || "")}`;
      comments.appendChild(row);
    }
    const box = document.createElement("div");
    box.className = "cm-comment-box";
    const input = document.createElement("input");
    input.maxLength = 300;
    input.placeholder = "说点什么…";
    const send = document.createElement("button");
    send.textContent = "评论";
    send.addEventListener("click", async () => {
      const text = input.value.trim();
      if (!text) return;
      const r = await fetch("/api/community/comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId: post.id, text }),
      });
      if (r.ok) loadCommunity();
      else {
        const d = await r.json();
        alert(d.error || "评论失败");
      }
    });
    box.append(input, send);
    comments.appendChild(box);
    card.appendChild(comments);
    list.appendChild(card);
  }
}

async function loadCommunity() {
  try {
    const r = await fetch("/api/community");
    if (!r.ok) return;
    const data = await r.json();
    cmPosts = data.posts || [];
    renderCommunity(cmPosts);
  } catch {}
}

$("cm-open").addEventListener("click", () => {
  $("cm-modal").classList.remove("hidden");
  loadCommunity();
});

document.querySelectorAll("#cm-tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    cmFilter = b.dataset.filter;
    document.querySelectorAll("#cm-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    renderCommunity(cmPosts);
  });
});

$("cm-text").addEventListener("input", () => {
  $("cm-counter").textContent = `${$("cm-text").value.length} / 1000`;
});

$("cm-media").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    $("cm-status").textContent = "文件不能超过 8MB";
    return;
  }
  cmFile = file;
  $("cm-media-name").textContent = file.name;
  const prev = $("cm-preview");
  prev.innerHTML = "";
  const url = URL.createObjectURL(file);
  if (String(file.type).startsWith("video/")) {
    const v = document.createElement("video");
    v.src = url;
    v.controls = true;
    prev.appendChild(v);
  } else {
    const img = document.createElement("img");
    img.src = url;
    prev.appendChild(img);
  }
});

$("cm-post").addEventListener("click", async () => {
  const title = $("cm-title").value.trim();
  const text = $("cm-text").value.trim();
  if (!title && !text && !cmFile) {
    $("cm-status").textContent = "写点内容或选个文件吧。";
    return;
  }
  $("cm-status").textContent = "发布中…";
  let media = null;
  if (cmFile) {
    const dataUrl = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(cmFile);
    });
    const up = await fetch("/api/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: dataUrl, mime: cmFile.type }),
    });
    const meta = await up.json();
    if (!up.ok) {
      $("cm-status").textContent = meta.error || "上传失败";
      return;
    }
    media = { url: meta.url, type: meta.type };
  }
  const r = await fetch("/api/community", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, text, media, tags: $("cm-tags").value }),
  });
  const data = await r.json();
  if (!r.ok) {
    $("cm-status").textContent = data.error || "发布失败";
    return;
  }
  $("cm-title").value = "";
  $("cm-text").value = "";
  cmFile = null;
  $("cm-media-name").textContent = "";
  $("cm-preview").innerHTML = "";
  $("cm-tags").value = "";
  $("cm-counter").textContent = "0 / 1000";
  $("cm-status").textContent = "已发布";
  loadCommunity();
});

async function importScenario(postId, title) {
  const r = await fetch("/api/community/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ postId }),
  });
  const data = await r.json();
  if (!r.ok) {
    alert(data.error || "导入失败");
    return;
  }
  try {
    const m = await (await fetch("/api/meta")).json();
    meta = m;
    renderScenarios(data.id);
  } catch {}
  const setupVisible = !$("setup").classList.contains("hidden");
  alert(`已导入「${data.title || title}」到你的剧本库${setupVisible ? "，已为你选中。" : "，下次开局时可以选它。"}`);
}

async function runSearch() {
  const q = $("cm-search").value.trim();
  const box = $("cm-search-results");
  box.innerHTML = "";
  if (!q) return;
  try {
    const r = await fetch("/api/search?q=" + encodeURIComponent(q));
    if (!r.ok) return;
    const data = await r.json();
    if (!data.players.length && !data.scenarios.length) {
      box.innerHTML = '<div class="hint" style="padding:8px 2px">没有找到匹配的玩家或剧本。</div>';
      return;
    }
    if (data.players.length) {
      const title = document.createElement("div");
      title.className = "cm-search-title";
      title.textContent = "玩家";
      box.appendChild(title);
      for (const p of data.players) {
        const chip = document.createElement("a");
        chip.className = "cm-chip";
        chip.href = "/space?u=" + encodeURIComponent(p.pid);
        chip.target = "_blank";
        chip.rel = "noopener";
        if (p.avatar) {
          const img = document.createElement("img");
          img.src = p.avatar;
          img.alt = "";
          chip.appendChild(img);
        }
        const n = document.createElement("span");
        n.textContent = p.name || "匿名旅人";
        chip.appendChild(n);
        box.appendChild(chip);
      }
    }
    if (data.scenarios.length) {
      const title = document.createElement("div");
      title.className = "cm-search-title";
      title.textContent = "剧本";
      box.appendChild(title);
      for (const s of data.scenarios) {
        const row = document.createElement("div");
        row.className = "cm-search-item";
        const info = document.createElement("div");
        const t = document.createElement("div");
        t.className = "cm-title";
        t.textContent = s.title;
        const m = document.createElement("div");
        m.className = "hint";
        m.textContent = [s.genre, "作者：" + (s.author || "匿名旅人")].filter(Boolean).join(" · ");
        info.append(t, m);
        const imp = document.createElement("button");
        imp.className = "cm-import";
        imp.textContent = "导入";
        imp.addEventListener("click", () => importScenario(s.id, s.title));
        row.append(info, imp);
        box.appendChild(row);
      }
    }
  } catch {}
}

$("cm-search-btn").addEventListener("click", runSearch);
$("cm-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runSearch();
  }
});

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.getAttribute("data-close");
    if (id) $(id).classList.add("hidden");
  });
});

try {
  const rk = (document.cookie.match(/(?:^|;\s*)rk=([^;]+)/) || [])[1];
  const rlink = document.querySelector('#hud a[href="/room"]');
  if (rk && rlink) rlink.href = "/room?k=" + encodeURIComponent(rk);
} catch {}

loadMe();
loadMeta();

/* ---------- 角色预设 ---------- */

function currentCharacterForm() {
  return {
    name: $("c-name").value,
    gender: $("c-gender").value,
    age: $("c-age").value,
    role: $("c-role").value,
    appearance: $("c-appearance").value,
    personality: $("c-personality").value,
    background: $("c-background").value,
    goal: $("c-goal").value,
    attrs: { ...setupState.attrs },
  };
}

function fillCharacterForm(c) {
  if (!c) return;
  $("c-name").value = c.name || "";
  $("c-gender").value = c.gender || "";
  $("c-age").value = c.age || "";
  $("c-role").value = c.role || "";
  $("c-appearance").value = c.appearance || "";
  $("c-personality").value = c.personality || "";
  $("c-background").value = c.background || "";
  $("c-goal").value = c.goal || "";
  if (c.attrs) {
    for (const [k, v] of Object.entries(c.attrs)) {
      if (setupState.attrs[k] !== undefined) setupState.attrs[k] = Math.max(meta.attrMin, Math.min(meta.attrMax, Number(v) || 5));
    }
    renderAttrs();
  }
}

function renderPresets(list) {
  if (list) meta.presets = list;
  const box = $("preset-list");
  box.innerHTML = "";
  const empty = el("option", "", "（还没有预设）");
  empty.value = "";
  box.appendChild(empty);
  for (const p of meta.presets || []) {
    const opt = el("option", "", `${p.name}${p.role ? ` · ${p.role}` : ""}`);
    opt.value = p.name;
    box.appendChild(opt);
  }
}

async function presetAction(path, options) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (data.error) {
    $("err").textContent = data.error;
    return null;
  }
  return data;
}

$("btn-save-preset").addEventListener("click", async () => {
  $("err").textContent = "";
  const name = $("preset-name").value.trim() || $("c-name").value.trim();
  if (!name) {
    $("err").textContent = "给预设起个名字，或者先把角色名填上。";
    return;
  }
  const data = await presetAction("/api/presets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, character: currentCharacterForm() }),
  });
  if (data) {
    renderPresets(data.presets);
    $("err").textContent = "";
    $("preset-name").value = name;
  }
});

$("btn-load-preset").addEventListener("click", async () => {
  const name = $("preset-list").value;
  if (!name) return;
  const res = await fetch(`/api/preset?name=${encodeURIComponent(name)}`);
  const data = await res.json();
  if (data.error) {
    $("err").textContent = data.error;
    return;
  }
  fillCharacterForm(data.character);
  $("err").textContent = `已读取预设「${name}」。`;
});

$("btn-del-preset").addEventListener("click", async () => {
  const name = $("preset-list").value;
  if (!name) return;
  if (!confirm(`删除角色预设「${name}」？`)) return;
  const data = await presetAction("/api/preset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (data) renderPresets(data.presets);
});

/* ---------- 属性随机 ---------- */

$("btn-random-attrs").addEventListener("click", () => {
  const keys = meta.attrs.map((a) => a.key);
  for (const k of keys) setupState.attrs[k] = meta.attrMin;
  let left = meta.attrPoints - keys.length * meta.attrMin;
  while (left > 0) {
    const k = keys[Math.floor(Math.random() * keys.length)];
    if (setupState.attrs[k] >= meta.attrMax) continue;
    setupState.attrs[k] += 1;
    left -= 1;
  }
  renderAttrs();
});

$("btn-reset-attrs").addEventListener("click", () => {
  for (const a of meta.attrs) setupState.attrs[a.key] = 5;
  renderAttrs();
});

/* ---------- 自定义剧本 ---------- */

function splitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function splitCols(line, max) {
  return line
    .split(/[|｜]/)
    .map((s) => s.trim())
    .concat(Array(max).fill(""))
    .slice(0, max);
}

function timeToMinute(text) {
  const m = String(text || "").match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
  if (!m) return 9 * 60;
  const h = Math.max(0, Math.min(23, Number(m[1])));
  const mi = Math.max(0, Math.min(59, Number(m[2])));
  return h * 60 + mi;
}

function fillScenarioForm(s) {
  $("s-title").value = s.title || "";
  $("s-genre").value = s.genre || "";
  $("s-blurb").value = s.blurb || "";
  $("s-tone").value = s.tone || "";
  $("s-version").value = s.version || "1.0";
  $("s-tags").value = (s.tags || []).join(", ");
  $("s-genre2").value = s.genre || "";
  $("s-version-note").value = s.versionNote || "";
  $("s-world").value = s.world || "";
  const rules = s.rules || {};
  $("s-rule-dice").checked = rules.diceDefault !== false;
  $("s-rule-dice-toggle").checked = rules.allowDiceToggle !== false;
  $("s-rule-fixed").checked = Boolean(rules.fixedOpeningDefault);
  $("s-rule-fixed-toggle").checked = rules.allowOpeningToggle !== false;
  $("s-rule-random").checked = rules.randomMode !== false;
  $("s-entities").value = (s.entities || []).map((e) => [e.name, e.info, e.setting, e.initial, e.summary, e.rules].join("｜")).join("\n");
  $("s-statuses").value = (s.statuses || []).map((x) => [x.name, x.initial, x.desc].join("｜")).join("\n");
  $("s-loops").value = (s.loopEvents || []).map((x) => [x.every, x.title, x.note].join("｜")).join("\n");
  $("s-plots").value = (s.plotPoints || []).map((x) => [x.title, x.note, x.at].join("｜")).join("\n");
  $("s-lexicon").value = (s.lexicon || []).map((x) => [x.term, x.def].join("｜")).join("\n");
  $("s-actions").value = (s.actions || []).map((x) => [x.label, x.text].join("｜")).join("\n");
  $("s-background").value = s.background || "";
  $("s-hook").value = s.hook || "";
  $("s-opening").value = s.opening || "";
  $("s-truth").value = s.truth || "";
  $("s-npcs").value = (s.npcs || []).map((n) => [n.name, n.desc, n.secret].filter(Boolean).join("｜")).join("\n");
  $("s-clues").value = (s.clues || []).join("\n");
  $("s-schedule").value = (s.schedule || [])
    .map((ev) => {
      const h = String(Math.floor(ev.minute / 60)).padStart(2, "0");
      const m = String(ev.minute % 60).padStart(2, "0");
      return [ev.day, `${h}:${m}`, ev.title, ev.note || ""].join("｜");
    })
    .join("\n");
  $("s-endings").value = (s.endings || []).map((e) => [e.name, e.condition].filter(Boolean).join("｜")).join("\n");
  $("s-day").value = s.startDay || 1;
  const h = String(Math.floor((s.startMinute ?? 540) / 60)).padStart(2, "0");
  const m = String((s.startMinute ?? 540) % 60).padStart(2, "0");
  $("s-time").value = `${h}:${m}`;
  $("s-money").value = s.startMoney ?? 0;
  $("s-items").value = (s.startItems || []).join(", ");
  scenarioLinks = (s.links || []).slice();
  $("s-links").value = "";
  $("s-links-note").textContent = "抓回来的正文会作为设定依据交给 GM";
  renderLinkList("s-links-list", scenarioLinks, "s-links-note");
}

function readScenarioForm() {
  return {
    title: $("s-title").value,
    genre: $("s-genre").value || $("s-genre2").value,
    blurb: $("s-blurb").value,
    tone: $("s-tone").value,
    version: $("s-version").value,
    tags: String($("s-tags").value || "").split(/[,，、]/).map((x) => x.trim()).filter(Boolean),
    versionNote: $("s-version-note").value,
    world: $("s-world").value,
    rules: {
      diceDefault: $("s-rule-dice").checked,
      allowDiceToggle: $("s-rule-dice-toggle").checked,
      fixedOpeningDefault: $("s-rule-fixed").checked,
      allowOpeningToggle: $("s-rule-fixed-toggle").checked,
      randomMode: $("s-rule-random").checked,
    },
    background: $("s-background").value,
    hook: $("s-hook").value,
    opening: $("s-opening").value,
    truth: $("s-truth").value,
    npcs: splitLines($("s-npcs").value).map((l) => {
      const [name, desc, secret] = splitCols(l, 3);
      return { name, desc, secret };
    }),
    clues: splitLines($("s-clues").value),
    schedule: splitLines($("s-schedule").value).map((l) => {
      const [day, time, title, note] = splitCols(l, 4);
      return { day: Number(day) || 1, minute: timeToMinute(time), title, note };
    }),
    endings: splitLines($("s-endings").value).map((l) => {
      const [name, condition] = splitCols(l, 2);
      return { name, condition };
    }),
    startDay: Number($("s-day").value) || 1,
    startMinute: timeToMinute($("s-time").value),
    startMoney: Number($("s-money").value) || 0,
    startItems: String($("s-items").value || "")
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean),
    entities: splitLines($("s-entities").value).map((line) => {
      const [name, info, setting, initial, summary, rules] = splitCols(line, 6);
      return { name, info, setting, initial, summary, rules };
    }),
    statuses: splitLines($("s-statuses").value).map((line) => {
      const [name, initial, desc] = splitCols(line, 3);
      return { name, initial, desc };
    }),
    loopEvents: splitLines($("s-loops").value).map((line) => {
      const [every, title, note] = splitCols(line, 3);
      return { every, title, note };
    }),
    plotPoints: splitLines($("s-plots").value).map((line) => {
      const [title, note, at] = splitCols(line, 3);
      return { title, note, at };
    }),
    lexicon: splitLines($("s-lexicon").value).map((line) => {
      const [term, def] = splitCols(line, 2);
      return { term, def };
    }),
    actions: splitLines($("s-actions").value).map((line) => {
      const [label, text] = splitCols(line, 2);
      return { label, text };
    }),
    links: scenarioLinks.slice(),
  };
}

/* ---------- 外部链接 ---------- */

let scenarioLinks = [];
let settingLinks = [];

function renderLinkList(listId, list, noteId) {
  const box = $(listId);
  box.innerHTML = "";
  if (!list.length) {
    box.appendChild(el("div", "hint", "（还没有导入链接）"));
    return;
  }
  for (const link of list) {
    const row = el("div", "link-item");
    row.appendChild(el("span", "t", link.title || link.url));
    row.appendChild(el("span", "c", `${link.chars || (link.text || "").length} 字`));
    const del = el("button", "", "✕");
    del.title = "移除这条";
    del.addEventListener("click", () => {
      const i = list.indexOf(link);
      if (i >= 0) list.splice(i, 1);
      renderLinkList(listId, list, noteId);
      if (noteId) $(noteId).textContent = "已移除一条链接。";
    });
    row.appendChild(del);
    box.appendChild(row);
  }
}

async function fetchLinksInto(textareaId, noteId, listId, target) {
  const urls = splitLines($(textareaId).value);
  if (!urls.length) {
    $(noteId).textContent = "先把链接贴进去。";
    return;
  }
  $(noteId).textContent = "正在抓取…";
  try {
    const res = await fetch("/api/links/fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const data = await res.json();
    if (data.error) {
      $(noteId).textContent = data.error;
      return;
    }
    for (const link of data.links || []) {
      if (!target.some((x) => x.url === link.url)) target.push(link);
    }
    const failed = (data.failed || []).map((f) => `${f.url}（${f.error}）`).join("；");
    $(noteId).textContent =
      `抓到 ${(data.links || []).length} 条` + (failed ? `，失败：${failed}` : "，记得点保存才会生效。");
    $(textareaId).value = "";
    renderLinkList(listId, target, noteId);
  } catch (e) {
    $(noteId).textContent = "抓取失败：" + e.message;
  }
}

$("btn-fetch-scenario-links").addEventListener("click", () =>
  fetchLinksInto("s-links", "s-links-note", "s-links-list", scenarioLinks)
);
$("btn-fetch-setting-links").addEventListener("click", () =>
  fetchLinksInto("set-links", "set-links-note", "set-links-list", settingLinks)
);

$("btn-custom-scenario").addEventListener("click", () => {
  if ($("custom-box").classList.contains("hidden")) {
    for (const id of ["s-title", "s-genre", "s-blurb", "s-tone", "s-background", "s-hook", "s-opening", "s-truth", "s-npcs", "s-clues", "s-schedule", "s-endings", "s-items", "s-links"]) {
      $(id).value = "";
    }
    $("s-day").value = "1";
    $("s-time").value = "18:00";
    $("s-money").value = "100";
    setupState.editingId = null;
    scenarioLinks = [];
    renderLinkList("s-links-list", scenarioLinks, "s-links-note");
  }
  $("custom-box").classList.remove("hidden");
  $("scenario-note").textContent = "在下面填好，保存后会出现在上面的剧本列表里。";
  updateScenarioPreview();
});

function escHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function updateScenarioPreview() {
  const box = $("scn-preview");
  if (!box) return;
  const title = $("s-title").value.trim() || "未命名剧本";
  const genre = $("s-genre").value.trim() || "未定类型";
  const blurb = $("s-blurb").value.trim() || "还没有一句话简介";
  const version = $("s-version").value.trim() || "1.0";
  const tags = $("s-tags").value.trim();
  const npcs = splitLines($("s-npcs").value).length;
  const clues = splitLines($("s-clues").value).length;
  const schedule = splitLines($("s-schedule").value).length;
  const endings = splitLines($("s-endings").value).length;
  const entities = splitLines($("s-entities").value).length;
  const statuses = splitLines($("s-statuses").value).length;
  const loops = splitLines($("s-loops").value).length;
  const plots = splitLines($("s-plots").value).length;
  const lexicon = splitLines($("s-lexicon").value).length;
  const actions = splitLines($("s-actions").value).length;
  box.innerHTML =
    `<div class="sp-title">${escHtml(title)}</div>` +
    `<div class="sp-genre">v${escHtml(version)} · ${escHtml(genre)}${tags ? " · " + escHtml(tags) : ""}</div>` +
    `<div class="sp-blurb">${escHtml(blurb)}</div>` +
    `<div class="sp-meta">人物 ${npcs} · 实体 ${entities} · 状态 ${statuses} · 线索 ${clues}</div>` +
    `<div class="sp-meta">时间节点 ${schedule} · 循环事件 ${loops} · 剧情点 ${plots} · 结局 ${endings}</div>` +
    `<div class="sp-meta">词条 ${lexicon} · 预设行动 ${actions} · 参考链接 ${scenarioLinks.length}</div>`;
}

for (const id of ["s-title", "s-genre", "s-blurb", "s-version", "s-tags", "s-npcs", "s-clues", "s-schedule", "s-endings", "s-entities", "s-statuses", "s-loops", "s-plots", "s-lexicon", "s-actions"]) {
  $(id).addEventListener("input", updateScenarioPreview);
}

$("btn-cancel-scenario").addEventListener("click", () => {
  $("custom-box").classList.add("hidden");
  $("scenario-note").textContent = "";
});

$("quick-new-scenario").addEventListener("click", () => $("btn-custom-scenario").click());
$("quick-community").addEventListener("click", () => $("cm-open").click());

$("btn-edit-scenario").addEventListener("click", async () => {
  if (!setupState.editingId) return;
  const res = await fetch(`/api/scenario?id=${encodeURIComponent(setupState.editingId)}`);
  const data = await res.json();
  if (data.error) {
    $("err").textContent = data.error;
    return;
  }
  fillScenarioForm(data.scenario);
  $("custom-box").classList.remove("hidden");
  $("scenario-note").textContent = `正在编辑「${data.scenario.title}」，保存会覆盖它。`;
});

$("btn-del-scenario").addEventListener("click", async () => {
  if (!setupState.editingId) return;
  if (!confirm("删除这个自定义剧本？")) return;
  const data = await presetAction("/api/scenario/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: setupState.editingId }),
  });
  if (data) {
    meta.scenarios = data.scenarios;
    setupState.editingId = null;
    $("custom-box").classList.add("hidden");
    renderScenarios();
    $("scenario-note").textContent = "剧本已删除。";
  }
});

$("btn-share-scenario").addEventListener("click", async () => {
  if (!setupState.editingId) return;
  if (!confirm("把这个剧本分享到创作社区？其他玩家可以导入并游玩。")) return;
  const r = await fetch("/api/scenario/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: setupState.editingId }),
  });
  const data = await r.json();
  if (!r.ok) {
    alert(data.error || "分享失败");
    return;
  }
  alert("已分享到创作社区。");
});

$("btn-save-scenario").addEventListener("click", async () => {
  $("err").textContent = "";
  const data = await presetAction("/api/scenario", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: setupState.editingId, data: readScenarioForm() }),
  });
  if (!data) return;
  meta.scenarios = data.scenarios;
  setupState.editingId = data.id;
  setupState.scenarioId = data.id;
  $("custom-box").classList.add("hidden");
  renderScenarios(data.id);
  $("scenario-note").textContent = "剧本已保存，并已选中它。";
});

$("s-import-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    alert("文件太大，剧本 JSON 请控制在 2MB 以内。");
    return;
  }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    alert("这个文件不是有效的 JSON。");
    return;
  }
  const r = await fetch("/api/scenario", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data }),
  });
  const out = await r.json();
  if (!r.ok) {
    alert(out.error || "导入失败");
    return;
  }
  try {
    meta = await (await fetch("/api/meta")).json();
    setupState.scenarioId = out.id;
    renderScenarios(out.id);
  } catch {}
  alert(`已导入「${data.title || "剧本"}」到你的剧本库。`);
});

/* ---------- 游戏内设定 ---------- */

function fillSettings() {
  const s = meta.settings || {};
  $("set-length").value = s.narrativeLength || "标准";
  $("set-effort").value = s.reasoningEffort || "low";
  $("set-critfail").value = String(s.allowCritFail !== false);
  $("set-advance").value = s.autoAdvanceMinutes ?? 10;
  $("set-extra").value = s.extraInstructions || "";
  settingLinks = (s.links || []).slice();
  $("set-links").value = "";
  $("set-links-note").textContent = "";
  renderLinkList("set-links-list", settingLinks, "set-links-note");
}

$("btn-save-settings").addEventListener("click", async () => {
  const payload = {
    narrativeLength: $("set-length").value,
    reasoningEffort: $("set-effort").value,
    allowCritFail: $("set-critfail").value === "true",
    autoAdvanceMinutes: Number($("set-advance").value) || 0,
    extraInstructions: $("set-extra").value,
    links: settingLinks.slice(),
  };
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.error) {
    $("settings-note").textContent = data.error;
    return;
  }
  meta.settings = data;
  fillSettings();
  $("settings-note").textContent = "已保存，下一回合生效。";
  setTimeout(() => ($("settings-note").textContent = ""), 2500);
});
