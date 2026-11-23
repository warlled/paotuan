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
let metaLoading = false;
let metaRetryTimer = 0;

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
  const all = meta?.scenarios || [];
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
  if (!meta) {
    const box = $("scenarios");
    box.innerHTML = "";
    box.appendChild(el("div", "hint", "正在加载剧本…如果长时间没有出现，会自动重试。"));
    $("sc-page").textContent = "正在加载";
    $("sc-prev").disabled = true;
    $("sc-next").disabled = true;
    $("start").disabled = true;
    return;
  }
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
      el("div", "g", `${s.genre}${s.playStyle === "open-world" ? " · 开放世界" : ""} · ${s.scheduleCount} 个日程节点${s.hasOpening ? " · 已写开场白" : ""}${s.editable ? " · 可编辑" : ""}`)
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
  $("start").disabled = false;
}

$("sc-prev").addEventListener("click", () => {
  if (scPage > 0) {
    scPage -= 1;
    renderScenarios();
  }
});
$("sc-next").addEventListener("click", () => {
  if (!meta) {
    loadMeta();
    return;
  }
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
  if (!meta?.difficulty) return;
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
  if (!meta?.attrs) return;
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
  if (metaLoading || meta) return;
  metaLoading = true;
  clearTimeout(metaRetryTimer);
  renderScenarios();
  try {
    const res = await fetch("/api/meta", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.scenarios) || !data.difficulty || !Array.isArray(data.attrs)) {
      throw new Error("返回数据不完整");
    }
    meta = data;
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
  } catch (err) {
    const box = $("scenarios");
    box.innerHTML = "";
    box.appendChild(el("div", "err", `剧本加载失败：${err.message || err}。3 秒后自动重试。`));
    $("sc-page").textContent = "加载失败";
    $("start").disabled = true;
    metaRetryTimer = setTimeout(() => {
      metaLoading = false;
      loadMeta();
    }, 3000);
    return;
  } finally {
    metaLoading = false;
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
        language: currentUiLanguage(),
      }),
    });
    const data = await res.json();
    if (data.error) {
      $("err").textContent = data.error;
      return;
    }
    session = data.session;
    try {
      localStorage.setItem("pt-autosave", JSON.stringify({ savedAt: Date.now(), session: { ...session, log: (session.log || []).slice(-200) } }));
    } catch {}
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

function renderQuickActions() {
  const box = $("quick");
  const actions = Array.isArray(session?.scenario?.actions) ? session.scenario.actions : [];
  if (!actions.length) return;
  box.innerHTML = "";
  for (const action of actions.slice(0, 8)) {
    if (!action?.label || !action?.text) continue;
    const button = el("button", "", action.label);
    button.dataset.q = action.text;
    box.appendChild(button);
  }
}

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
  $("clue-sect")?.classList.toggle("hidden", !(session.clues || []).length);
  (session.clues || []).forEach((i) => clues.appendChild(el("span", "tag clue", i)));

  const sched = $("schedule");
  sched.innerHTML = "";
  const upcomingKeys = new Set((session.upcoming || []).map((u) => u.key));
  const nextKey = (session.upcoming || [])[0]?.key;
  for (const ev of session.schedule || []) {
    const row = el("div", "row" + (ev.fired ? " done" : upcomingKeys.has(ev.key) ? (ev.key === nextKey ? " next" : "") : ""));
    row.appendChild(el("div", "when", `${String(ev.at || "").replace("T", " ")}${ev.fired ? " · 已发生" : ""}`));
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
  $("objective-sect")?.classList.toggle("hidden", !objectives.length);
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
    row.appendChild(el("div", "when", e.at || "时间未记录"));
    row.appendChild(el("div", "", e.title));
    evBox.appendChild(row);
  }

  const worldStyle = session.mode === "free" ? "自由叙事" : session.scenario?.playStyle === "open-world" ? "开放世界" : "";
  $("tb-title").textContent = `${session.scenario.title} · ${c.name}${worldStyle ? " · " + worldStyle : ""}`;
  $("tb-clock").textContent = session.clock;
  renderQuickActions();

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
    let res = await fetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, language: currentUiLanguage() }),
    });
    let data = await res.json();
    if (!res.ok && data.needNewGame) {
      let backup = null;
      try {
        backup = JSON.parse(localStorage.getItem("pt-autosave") || "null");
      } catch {}
      if (backup && backup.session) {
        const ir = await fetch("/api/save/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: backup.session }),
        });
        if (ir.ok) {
          const restored = await ir.json();
          session = restored.session;
          appendSegment({ type: "sys", text: "服务器重启过，已从本机自动备份恢复进度，正在重试这一步。" });
          res = await fetch("/api/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, language: currentUiLanguage() }),
          });
          data = await res.json();
        }
      }
    }
    setBusy(false);
    if (data.error) {
      appendSegment({ type: "sys", text: data.error });
      return;
    }
    session = data.session;
    try {
      localStorage.setItem("pt-autosave", JSON.stringify({ savedAt: Date.now(), session: { ...session, log: (session.log || []).slice(-200) } }));
    } catch {}
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

$("quick").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-q]");
  if (button?.dataset.q) act(button.dataset.q);
});

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
    `<div class="op-story">${escHtml(opening)}</div>` +
    (Array.isArray(sc.actions) && sc.actions.length
      ? `<div class="op-sec">可从这里开始</div><div class="op-meta">${sc.actions.map((action) => escHtml(action.label)).join(" · ")}。也可以完全不选，直接输入自己的目标。</div>`
      : "");
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
  loadModelInfo();
});

const MODEL_CATALOG = [
  { id:"deepseek", name:"DeepSeek", color:"#4D6BFE", icon:"DS", baseUrl:"https://api.deepseek.com", models:["deepseek-chat","deepseek-reasoner","deepseek-v4.1-flash","deepseek-v4-flash"] },
  { id:"openai", name:"ChatGPT / OpenAI", color:"#E8E4DA", icon:"GPT", baseUrl:"https://api.openai.com/v1", models:["gpt-4o","gpt-4o-mini","gpt-4.1","gpt-4.1-mini","o3","o4-mini"] },
  { id:"anthropic", name:"Anthropic Claude", color:"#D97757", icon:"C", baseUrl:"https://api.anthropic.com/v1", models:["claude-sonnet-4-20250514","claude-opus-4-20250514","claude-3-7-sonnet-20250219","claude-3-5-haiku-20241022"] },
  { id:"doubao", name:"豆包 Doubao", color:"#1664FF", icon:"豆", baseUrl:"https://ark.cn-beijing.volces.com/api/v3", models:["doubao-1-5-pro-32k","doubao-1-5-lite-32k","doubao-pro-32k","doubao-lite-32k"] },
  { id:"qwen", name:"通义千问 Qwen", color:"#615CED", icon:"Q", baseUrl:"https://dashscope.aliyuncs.com/compatible-mode/v1", models:["qwen-max","qwen-plus","qwen-turbo"] },
  { id:"kimi", name:"Kimi / Moonshot", color:"#1E1E1E", icon:"K", baseUrl:"https://api.moonshot.cn/v1", models:["moonshot-v1-8k","moonshot-v1-32k","moonshot-v1-128k"] },
  { id:"zhipu", name:"智谱 GLM", color:"#3857F4", icon:"GLM", baseUrl:"https://open.bigmodel.cn/api/paas/v4", models:["glm-4-plus","glm-4-air","glm-4-flash"] },
  { id:"baidu", name:"百度文心 ERNIE", color:"#2932E1", icon:"文", baseUrl:"https://qianfan.baidubce.com/v2", models:["ernie-4.0-8k","ernie-3.5-8k","ernie-speed-8k"] },
  { id:"spark", name:"讯飞星火 Spark", color:"#0A6CFF", icon:"星", baseUrl:"https://spark-api-open.xf-yun.com/v1", models:["generalv3.5","4.0Ultra"] },
  { id:"hunyuan", name:"腾讯混元 Hunyuan", color:"#0052D9", icon:"混", baseUrl:"https://api.hunyuan.cloud.tencent.com/v1", models:["hunyuan-pro","hunyuan-standard"] },
  { id:"minimax", name:"MiniMax", color:"#FF5C35", icon:"M", baseUrl:"https://api.minimax.chat/v1", models:["abab6.5s-chat","abab6.5g-chat"] },
  { id:"step", name:"阶跃星辰 Step", color:"#7B61FF", icon:"S", baseUrl:"https://api.stepfun.com/v1", models:["step-1-8k","step-1-32k"] },
  { id:"yi", name:"零一万物 Yi", color:"#00A3FF", icon:"Y", baseUrl:"https://api.lingyiwanwu.com/v1", models:["yi-large","yi-medium"] },
  { id:"siliconflow", name:"硅基流动 SiliconFlow", color:"#6E56CF", icon:"SF", baseUrl:"https://api.siliconflow.cn/v1", models:["Qwen/Qwen2.5-72B-Instruct","deepseek-ai/DeepSeek-V3"] },
  { id:"openrouter", name:"OpenRouter 聚合", color:"#6467F2", icon:"OR", baseUrl:"https://openrouter.ai/api/v1", models:["openai/gpt-4o","anthropic/claude-sonnet-4","anthropic/claude-3.7-sonnet","google/gemini-2.0-flash-001","meta-llama/llama-3.3-70b-instruct"] },
  { id:"gemini", name:"Google Gemini", color:"#4285F4", icon:"G", baseUrl:"https://generativelanguage.googleapis.com/v1beta/openai", models:["gemini-2.0-flash","gemini-1.5-pro"] },
  { id:"grok", name:"xAI Grok", color:"#111111", icon:"X", baseUrl:"https://api.x.ai/v1", models:["grok-2-latest","grok-beta"] },
  { id:"mistral", name:"Mistral", color:"#FF7000", icon:"M", baseUrl:"https://api.mistral.ai/v1", models:["mistral-large-latest","mistral-small-latest"] },
  { id:"groq", name:"Groq", color:"#F55036", icon:"GQ", baseUrl:"https://api.groq.com/openai/v1", models:["llama-3.3-70b-versatile","mixtral-8x7b-32768"] },
  { id:"perplexity", name:"Perplexity", color:"#20808D", icon:"P", baseUrl:"https://api.perplexity.ai", models:["sonar","sonar-pro"] },
  { id:"ollama", name:"本地 Ollama", color:"#333333", icon:"OL", baseUrl:"http://127.0.0.1:11434/v1", models:["qwen2.5:7b","llama3.1:8b"] },
  { id:"custom", name:"自定义 / 其他兼容接口", color:"#666666", icon:"AI", baseUrl:"", models:[] },
];

function setModelIcon(p) {
  const el = $("model-icon");
  el.textContent = p?.icon || "AI";
  el.style.setProperty("--brand", p?.color || "#555");
  el.style.color = p?.id === "openai" ? "#1b1b1b" : "#fff";
  el.title = p?.name || "自定义";
}

function buildModelPicker() {
  const sel = $("model-picker");
  if (!sel || sel.dataset.built) return;
  sel.dataset.built = "1";
  for (const p of MODEL_CATALOG) {
    const g = document.createElement("optgroup");
    g.label = `${p.icon} ${p.name}`;
    if (!p.models.length) {
      const o = document.createElement("option");
      o.value = p.id + "|";
      o.textContent = "自定义";
      g.appendChild(o);
    }
    for (const m of p.models) {
      const o = document.createElement("option");
      o.value = p.id + "|" + m;
      o.textContent = m;
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
  sel.addEventListener("change", () => {
    const [pid, model] = sel.value.split("|");
    const p = MODEL_CATALOG.find((x) => x.id === pid);
    if (!p) return;
    if (p.baseUrl) $("model-base").value = p.baseUrl;
    if (model) $("model-name").value = model;
    setModelIcon(p);
  });
}

async function loadModelInfo() {
  try {
    const m = await (await fetch("/api/model")).json();
    $("model-base").value = m.baseUrl || "";
    $("model-name").value = m.model || "";
    $("model-enabled").checked = !m.enabled;
    $("model-key").value = "";
    $("model-key").placeholder = m.keyMask ? `已保存：${m.keyMask}（留空不改）` : "sk-...";
    $("model-status").textContent = m.configured
      ? (m.enabled ? "已启用，你的对局会优先使用自己的模型" : "已保存，但未启用")
      : "未配置，将使用站点免费模型";
    const p = MODEL_CATALOG.find((x) => x.baseUrl && (m.baseUrl || "").startsWith(x.baseUrl));
    setModelIcon(p);
    if (p && p.models.includes(m.model)) $("model-picker").value = `${p.id}|${m.model}`;
  } catch {}
}

$("model-save").addEventListener("click", async () => {
  const r = await fetch("/api/model", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      enabled: !$("model-enabled").checked,
      baseUrl: $("model-base").value,
      model: $("model-name").value,
      apiKey: $("model-key").value,
    }),
  });
  const d = await r.json();
  $("model-status").textContent = r.ok ? "已保存" : d.error || "保存失败";
  if (r.ok) loadModelInfo();
});

$("model-test").addEventListener("click", async () => {
  $("model-status").textContent = "测试中…";
  const r = await fetch("/api/model/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseUrl: $("model-base").value,
      model: $("model-name").value,
      apiKey: $("model-key").value,
    }),
  });
  const d = await r.json();
  $("model-status").textContent = r.ok ? `连接成功：${d.reply}` : d.error || "测试失败";
});

$("model-clear").addEventListener("click", async () => {
  if (!confirm("清除自己保存的模型配置？")) return;
  await fetch("/api/model", { method: "DELETE" });
  loadModelInfo();
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
    return p.category === cmFilter;
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
    if (post.category) {
      const cat = document.createElement("span");
      cat.className = "tag";
      cat.textContent = post.category;
      card.appendChild(cat);
      cat.style.marginTop = "4px";
    }
    if (post.pid && me && post.pid === me.pid) {
      const del = document.createElement("button");
      del.textContent = "删除";
      del.className = "cm-like";
      del.style.marginLeft = "8px";
      del.addEventListener("click", async () => {
        if (!confirm("删除这条作品？")) return;
        const r = await fetch("/api/community/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: post.id }),
        });
        if (r.ok) loadCommunity();
        else alert("删除失败");
      });
      card.appendChild(del);
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
    body: JSON.stringify({ title, text, media, tags: $("cm-tags").value, category: $("cm-category").value }),
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

(function initHudDrag() {
  const box = $("hud-left");
  const grip = document.querySelector(".hud-grip");
  if (!box || !grip) return;
  const KEY = "pt-hud-pos";
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) {
      box.style.left = p.left + "px";
      box.style.top = p.top + "px";
    }
  } catch {}
  let drag = null;
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const r = box.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const left = Math.max(4, Math.min(window.innerWidth - w - 4, drag.left + e.clientX - drag.x));
    const top = Math.max(4, Math.min(window.innerHeight - h - 4, drag.top + e.clientY - drag.y));
    box.style.left = left + "px";
    box.style.top = top + "px";
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    try {
      localStorage.setItem(KEY, JSON.stringify({ left: box.offsetLeft, top: box.offsetTop }));
    } catch {}
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
})();

$("btn-export-play").addEventListener("click", () => {
  if (!session) {
    alert("先开始一局游戏，再导出游玩记录。");
    return;
  }
  if (typeof PptxGenJS === "undefined") {
    alert("PPT 组件还没加载好，等一秒再点，或者刷新页面重试。");
    return;
  }
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  const c = session.character || {};
  const sc = session.scenario || {};
  const g = session.growth || {};
  const cover = pptx.addSlide();
  cover.addText(`${sc.title || "跑团"} · ${c.name || ""}`, { x: 0.5, y: 1.1, w: 9, h: 1, fontSize: 28, bold: true });
  cover.addText(`${session.mode === "free" ? "自由探索" : "跑团"} · ${(meta?.difficulty?.[session.difficulty]?.label) || ""} · ${session.clock || ""}`, { x: 0.5, y: 2.1, w: 9, fontSize: 14 });
  cover.addText(`导出时间：${new Date().toLocaleString("zh-CN")}`, { x: 0.5, y: 2.6, w: 9, fontSize: 12 });
  const slide = (h, b) => {
    if (!b) return;
    const s = pptx.addSlide();
    s.addText(h, { x: 0.4, y: 0.3, w: 9.2, fontSize: 18, bold: true });
    s.addText(String(b), { x: 0.4, y: 0.95, w: 9.2, h: 4.7, fontSize: 10.5, valign: "top" });
  };
  const attrs = (meta?.attrs || []).map((a) => `${a.label} ${c.attrs?.[a.key] ?? "-"}`).join("　");
  const skills = (meta?.skills || []).map((s) => `${s.name} ${c.attrs?.[s.attr] ?? "-"}`).join("　");
  slide("角色卡", `姓名：${c.name}\n称呼：${c.gender || ""}　年龄：${c.age || ""}\n身份：${c.role || ""}\n外貌：${c.appearance || ""}\n性格：${c.personality || ""}\n背景：${c.background || ""}\n目标：${c.goal || ""}\n\n属性：${attrs}\n技能：${skills}`);
  slide("状态与成长", `生命：${session.status?.hp}/${session.status?.hpMax}\n理智：${session.status?.san}/${session.status?.sanMax}\n金钱：${session.status?.money}\n等级：${g.level || 1}　经验：${g.xp || 0}\n地点：${session.location || "未记录"}\n已认识：${(session.npcsKnown || []).join("、") || "无"}\n\n物品：${(session.inventory || []).join("、") || "空"}\n线索：${(session.clues || []).join("、") || "无"}`);
  slide("关系与任务", `人物关系：\n${Object.entries(session.relations || {}).map(([k, v]) => `${k}：${v.attitude || ""}（${v.value ?? 0}）${v.note ? " " + v.note : ""}`).join("\n") || "无"}\n\n目标：${(session.objectives || []).map((o) => o.text + (o.done ? "（已完成）" : "")).join("、") || "无"}\n任务：${(session.quests || []).map((o) => o.text + (o.done ? "（已完成）" : "")).join("、") || "无"}`);
  slide("事件与日程", `已发生事件：\n${(session.eventLog || []).map((e) => `${e.at || ""} ${e.title}`).join("\n") || "无"}\n\n时间表：\n${(session.schedule || []).map((e) => `${String(e.at || "").replace("T", " ")} ${e.title}${e.fired ? "（已发生）" : ""}`).join("\n")}`);
  const lines = (session.log || []).map((e) => {
    const tag = e.type === "player" ? "玩家" : e.type === "gm" ? "GM" : e.type === "dice" ? "判定" : e.type === "event" ? "事件" : e.type === "change" ? "变化" : "系统";
    return `[${tag}] ${e.text}`;
  });
  let buf = "", idx = 1;
  const flush = () => {
    if (buf.trim()) {
      slide(`剧情记录 ${idx++}`, buf);
      buf = "";
    }
  };
  for (const line of lines) {
    if ((buf + line).length > 900) flush();
    buf += line + "\n";
  }
  flush();
  pptx.writeFile({ fileName: `${sc.title || "跑团"}-${c.name || "角色"}-游玩记录.pptx` }).catch(() => alert("导出失败，请重试。"));
});

function currentUiLanguage() {
  return window.PT_I18N?.getLanguage() || (() => {
    try {
      return localStorage.getItem("pt-lang") || "zh-Hans";
    } catch {
      return "zh-Hans";
    }
  })();
}
function applyLang(lang, options = {}) {
  window.PT_I18N?.setLanguage(lang, options);
}
function applyZoom(value) {
  document.body.style.zoom = String(value);
  document.querySelectorAll("[data-zoom]").forEach((b) => {
    b.classList.toggle("on", Number(b.dataset.zoom) === Number(value));
  });
}
document.querySelectorAll("[data-zoom]").forEach((b) => {
  b.addEventListener("click", () => {
    const v = Number(b.dataset.zoom);
    applyZoom(v);
    try { localStorage.setItem("pt-zoom", String(v)); } catch {}
  });
});
$("lang-select").addEventListener("change", () => {
  const lang = $("lang-select").value;
  applyLang(lang, { allowRemoteModel: true });
  try { localStorage.setItem("pt-lang", lang); } catch {}
});
window.addEventListener("pt-language-changed", (event) => {
  const lang = event.detail?.language || currentUiLanguage();
  try { localStorage.setItem("pt-lang", lang); } catch {}
});
try {
  const z = Number(localStorage.getItem("pt-zoom"));
  if (z) applyZoom(z);
  const l = localStorage.getItem("pt-lang") || "zh-Hans";
  $("lang-select").value = l;
  applyLang(l, { silent: true });
} catch {}

buildModelPicker();
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
  if (!meta?.attrs) {
    loadMeta();
    return;
  }
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
  if (!meta?.attrs) {
    loadMeta();
    return;
  }
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

const SCENARIO_ROW_META = {
  npc: { container: "editor-npcs", count: "count-npcs", empty: "未添加人物", noun: "人物" },
  clue: { container: "editor-clues", count: "count-clues", empty: "未添加线索", noun: "线索" },
  schedule: { container: "editor-schedule", count: "count-schedule", empty: "未添加时间节点", noun: "节点" },
  ending: { container: "editor-endings", count: "count-endings", empty: "未添加结局", noun: "结局" },
  entity: { container: "editor-entity-list", count: "count-entities", empty: "未添加实体", noun: "实体" },
  status: { container: "editor-statuses", count: "count-statuses", empty: "未添加状态", noun: "状态" },
  loop: { container: "editor-loops", count: "count-loops", empty: "未添加循环事件", noun: "事件" },
  plot: { container: "editor-plots", count: "count-plots", empty: "未添加剧情点", noun: "剧情点" },
  lexicon: { container: "editor-lexicon-list", count: "count-lexicon", empty: "未添加词条", noun: "词条" },
  action: { container: "editor-actions", count: "count-actions", empty: "未添加预设行动", noun: "行动" },
  random: { container: "editor-randoms", count: "count-randoms", empty: "未添加随机项", noun: "随机项" },
  openingOption: { container: "editor-opening-options", count: "count-opening-options", empty: "未添加开局选项", noun: "选项" },
};

function minuteToTime(minute) {
  const n = Math.max(0, Math.min(1439, Number(minute) || 0));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

function dateTimeLocalValue(value) {
  const text = String(value || "").trim();
  const full = text.match(/^(\d{1,4})[-/](\d{1,2})[-/](\d{1,2})[T\s](\d{1,2}):(\d{2})/);
  if (full) {
    return `${full[1].padStart(4, "0")}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}T${full[4].padStart(2, "0")}:${full[5]}`;
  }
  const time = text.match(/^(\d{1,2}):(\d{2})$/);
  if (time) return `2026-01-01T${time[1].padStart(2, "0")}:${time[2]}`;
  return "2026-01-01T18:00";
}

function makeScenarioField(label, field, value, options = {}) {
  const wrap = el("label", "editor-field");
  wrap.appendChild(el("span", "", label));
  let control;
  if (options.select) {
    control = document.createElement("select");
    for (const item of options.select) {
      const option = document.createElement("option");
      option.value = typeof item === "string" ? item : item.value;
      option.textContent = typeof item === "string" ? item : item.label;
      control.appendChild(option);
    }
  } else if (options.multiline) {
    control = document.createElement("textarea");
  } else {
    control = document.createElement("input");
    control.type = options.type || "text";
    if (options.min != null) control.min = options.min;
    if (options.max != null) control.max = options.max;
  }
  control.dataset.field = field;
  control.value = value == null ? "" : String(value);
  if (options.placeholder) control.placeholder = options.placeholder;
  if (options.maxlength) control.maxLength = options.maxlength;
  wrap.appendChild(control);
  return wrap;
}

function makeScenarioCheck(label, field, checked) {
  const wrap = el("label", "editor-field editor-check-field");
  const line = el("span", "editor-check-inline");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.field = field;
  input.checked = Boolean(checked);
  line.appendChild(input);
  line.appendChild(document.createTextNode(label));
  wrap.appendChild(line);
  return wrap;
}

function scenarioGrid(className, nodes) {
  const grid = el("div", `editor-field-grid ${className || ""}`.trim());
  for (const node of nodes) if (node) grid.appendChild(node);
  return grid;
}

function scenarioRowTitle(type, data) {
  const value = (...keys) => {
    for (const key of keys) if (String(data[key] || "").trim()) return String(data[key]).trim();
    return "";
  };
  if (type === "npc") return value("name") || "新人物";
  if (type === "clue") return value("text") || "新线索";
  if (type === "schedule") return value("title") || "新时间节点";
  if (type === "ending") return value("name") || "新结局";
  if (type === "entity") return value("name") || "新实体";
  if (type === "status") return value("name") || "新持续状态";
  if (type === "loop") return value("title") || "新循环事件";
  if (type === "plot") return value("title") || "新剧情点";
  if (type === "lexicon") return value("term") || "新词条";
  if (type === "action") return value("label") || "新预设行动";
  if (type === "random") return value("name") || "新随机项";
  return value("text") || "新开局选项";
}

function scenarioRowMeta(type, data) {
  if (type === "npc") return [data.faction, data.role].filter(Boolean).join(" · ");
  if (type === "clue") return data.category || "";
  if (type === "schedule") return String(data.at || "").replace("T", " ");
  if (type === "entity") return [data.group, data.kind].filter(Boolean).join(" · ");
  if (type === "status") return data.initial ? `初始 ${data.initial}` : "";
  if (type === "loop") return data.every || "";
  if (type === "plot") return data.at || "";
  if (type === "lexicon") return data.path || "";
  if (type === "action") return data.kind || "";
  if (type === "random") return `${Number(data.diceCount) || 1}d${Number(data.diceSides) || 100}`;
  return "";
}

function refreshScenarioRowHead(card, type) {
  const data = {};
  card.querySelectorAll("[data-field]").forEach((field) => {
    if (field.closest(".editor-nested")) return;
    data[field.dataset.field] = field.type === "checkbox" ? field.checked : field.value;
  });
  const title = card.querySelector(".editor-repeat-title");
  const meta = card.querySelector(".editor-repeat-meta");
  if (title) title.textContent = scenarioRowTitle(type, data);
  if (meta) meta.textContent = scenarioRowMeta(type, data);
}

function makeRowTool(label, action, title) {
  const button = el("button", "", label);
  button.type = "button";
  button.dataset.rowAction = action;
  button.title = title;
  return button;
}

function appendEntityAttribute(container, data = {}) {
  const row = el("div", "editor-nested-row attribute-row");
  row.dataset.nestedRow = "entityAttr";
  row.appendChild(makeScenarioField("属性组", "group", data.group || "基础属性", { placeholder: "基础属性" }));
  row.appendChild(makeScenarioField("属性名称", "name", data.name || "", { placeholder: "生命" }));
  row.appendChild(makeScenarioField("初始值", "initial", data.initial || "", { placeholder: "100" }));
  row.appendChild(makeScenarioField("属性规则", "rule", data.rule || "", { placeholder: "降至 0 时……" }));
  const remove = el("button", "editor-nested-remove", "×");
  remove.type = "button";
  remove.dataset.nestedRemove = "true";
  remove.title = "删除这条属性";
  row.appendChild(remove);
  container.appendChild(row);
}

function appendRandomRange(container, data = {}) {
  const row = el("div", "editor-nested-row range-row");
  row.dataset.nestedRow = "randomRange";
  row.appendChild(makeScenarioField("最小值", "min", data.min ?? "", { type: "number", placeholder: "1" }));
  row.appendChild(makeScenarioField("最大值", "max", data.max ?? "", { type: "number", placeholder: "30" }));
  row.appendChild(makeScenarioField("命中结果", "hit", data.hit || "", { placeholder: "大失败 / 成功但有代价" }));
  const remove = el("button", "editor-nested-remove", "×");
  remove.type = "button";
  remove.dataset.nestedRemove = "true";
  remove.title = "删除这个结果区间";
  row.appendChild(remove);
  container.appendChild(row);
}

function buildScenarioRow(type, data = {}, collapsed = true) {
  const card = el("div", "editor-repeat-card");
  card.dataset.rowType = type;
  if (collapsed) card.classList.add("is-collapsed");
  const head = el("div", "editor-repeat-head");
  const toggle = el("button", "editor-repeat-toggle");
  toggle.type = "button";
  toggle.dataset.rowAction = "toggle";
  const title = el("span", "editor-repeat-title", scenarioRowTitle(type, data));
  const meta = el("span", "editor-repeat-meta", scenarioRowMeta(type, data));
  toggle.appendChild(title);
  toggle.appendChild(meta);
  head.appendChild(toggle);
  const tools = el("div", "editor-row-tools");
  tools.appendChild(makeRowTool("↑", "up", "上移"));
  tools.appendChild(makeRowTool("↓", "down", "下移"));
  tools.appendChild(makeRowTool("⧉", "copy", "复制"));
  tools.appendChild(makeRowTool("×", "remove", "删除"));
  head.appendChild(tools);
  card.appendChild(head);

  const body = el("div", "editor-repeat-body");
  if (type === "npc") {
    body.appendChild(scenarioGrid("editor-grid-3", [
      makeScenarioField("姓名", "name", data.name || "", { placeholder: "陆守仁" }),
      makeScenarioField("所属势力", "faction", data.faction || "", { placeholder: "陆家 / 调查局" }),
      makeScenarioField("身份", "role", data.role || "", { placeholder: "当家 / 联络人" }),
      makeScenarioField("初始态度", "attitude", data.attitude || "", { placeholder: "戒备 / 友好 / 中立" }),
      makeScenarioField("公开描述", "desc", data.desc || "", { multiline: true, placeholder: "玩家第一眼能观察到什么" }),
      makeScenarioField("隐藏内情", "secret", data.secret || "", { multiline: true, placeholder: "GM 知道但不会直接说出的信息" }),
    ]));
  } else if (type === "clue") {
    body.appendChild(scenarioGrid("editor-grid-2", [
      makeScenarioField("分类", "category", data.category || "", { placeholder: "物证 / 传闻 / 地点" }),
      makeScenarioField("线索正文", "text", data.text || "", { placeholder: "药渣里有乌头的苦味" }),
    ]));
  } else if (type === "schedule") {
    const defaultAt = data.at || ($("s-start-at") && $("s-start-at").value) || "2026-01-01T18:00";
    body.appendChild(scenarioGrid("editor-grid-2", [
      makeScenarioField("日期与时间", "at", dateTimeLocalValue(defaultAt), { type: "datetime-local" }),
      makeScenarioField("事件标题", "title", data.title || "", { placeholder: "后厅开宴" }),
      makeScenarioField("说明", "note", data.note || "", { placeholder: "所有人必须到场" }),
    ]));
  } else if (type === "ending") {
    body.appendChild(scenarioGrid("editor-grid-2", [
      makeScenarioField("结局名称", "name", data.name || "", { placeholder: "当众揭破" }),
      makeScenarioField("达成条件", "condition", data.condition || "", { multiline: true, placeholder: "在老爷死前把凶手与旧案一并揭出" }),
    ]));
  } else if (type === "entity") {
    body.appendChild(scenarioGrid("editor-grid-3", [
      makeScenarioField("实体组", "group", data.group || "人物", { placeholder: "人物 / 物品 / 地点 / 势力" }),
      makeScenarioField("实体名称", "name", data.name || "", { placeholder: "黄铜怀表" }),
      makeScenarioField("实体类型", "kind", data.kind || "", { placeholder: "玩家 / NPC / 物品" }),
      makeScenarioField("信息", "info", data.info || "", { placeholder: "用途或类型" }),
      makeScenarioField("初始值", "initial", data.initial || "", { placeholder: "完好 / 100" }),
      makeScenarioField("简介", "summary", data.summary || "", { placeholder: "一句话说明它是什么" }),
      makeScenarioField("设定", "setting", data.setting || "", { multiline: true, placeholder: "来历、隐藏性质与在世界中的位置" }),
      makeScenarioField("规则", "rules", data.rules || "", { multiline: true, placeholder: "如何使用、何时变化、会触发什么" }),
      makeScenarioCheck("玩家实体", "isPlayer", data.isPlayer),
    ]));
    const flags = el("div", "editor-field-grid editor-grid-3");
    flags.appendChild(makeScenarioCheck("默认隐藏", "hidden", data.hidden));
    flags.appendChild(makeScenarioCheck("初始可见", "visible", data.visible !== false));
    body.appendChild(flags);
    const nested = el("div", "editor-nested");
    const nestedHead = el("div", "editor-nested-head");
    nestedHead.appendChild(el("b", "", "属性组 / 属性字段"));
    nestedHead.appendChild(el("span", "", "可继续细分属性与初始值"));
    nested.appendChild(nestedHead);
    const list = el("div", "editor-nested-list");
    list.dataset.nestedList = "entityAttr";
    nested.appendChild(list);
    for (const attr of data.attributes || []) appendEntityAttribute(list, attr);
    const add = el("button", "editor-add-small", "＋ 添加属性");
    add.type = "button";
    add.dataset.entityAddAttr = "true";
    nested.appendChild(add);
    body.appendChild(nested);
  } else if (type === "status") {
    body.appendChild(scenarioGrid("editor-grid-3", [
      makeScenarioField("状态名称", "name", data.name || "", { placeholder: "中毒" }),
      makeScenarioField("初始值", "initial", data.initial || "", { placeholder: "1 层 / 50" }),
      makeScenarioField("过期时间", "expiresAt", data.expiresAt || "", { placeholder: "第 2 天后 / 治疗时结束" }),
      makeScenarioField("说明", "desc", data.desc || "", { multiline: true, placeholder: "每回合产生什么效果，如何解除" }),
    ]));
  } else if (type === "loop") {
    body.appendChild(scenarioGrid("editor-grid-3", [
      makeScenarioField("频率", "every", data.every || "每天", { placeholder: "每天 23:00 / 每周一次" }),
      makeScenarioField("事件标题", "title", data.title || "", { placeholder: "钟声" }),
      makeScenarioField("下次触发", "nextAt", data.nextAt || "", { placeholder: "第1天 23:00" }),
      makeScenarioField("过期时间", "expiresAt", data.expiresAt || "", { placeholder: "留空表示长期循环" }),
      makeScenarioField("说明", "note", data.note || "", { multiline: true, placeholder: "全城都能听见，听到后会……" }),
    ]));
  } else if (type === "plot") {
    body.appendChild(scenarioGrid("editor-grid-3", [
      makeScenarioField("剧情点标题", "title", data.title || "", { placeholder: "第一封信" }),
      makeScenarioField("触发时间", "at", data.at || "", { placeholder: "第1天 20:00" }),
      makeScenarioField("生效效果", "effect", data.effect || "", { placeholder: "解锁线索 / 改变关系 / 推进时间" }),
      makeScenarioField("内容", "note", data.note || "", { multiline: true, placeholder: "信从门缝里塞进来……" }),
    ]));
  } else if (type === "lexicon") {
    body.appendChild(scenarioGrid("editor-grid-3", [
      makeScenarioField("层级路径", "path", data.path || "", { placeholder: "世界 / 势力 / 教会" }),
      makeScenarioField("词条标题", "term", data.term || "", { placeholder: "交界地" }),
      makeScenarioField("解释", "def", data.def || "", { multiline: true, placeholder: "词条在世界观中的准确含义" }),
      makeScenarioCheck("初始可见", "visible", data.visible !== false),
    ]));
  } else if (type === "action") {
    body.appendChild(scenarioGrid("editor-grid-3", [
      makeScenarioField("按钮名称", "label", data.label || "", { placeholder: "观察四周" }),
      makeScenarioField("行动类型", "kind", data.kind || "text", { select: ["text", "explore", "social", "investigate", "combat"] }),
      makeScenarioField("补充说明", "note", data.note || "", { placeholder: "选择后会附带哪些意图" }),
      makeScenarioField("行动文本", "text", data.text || "", { multiline: true, placeholder: "我先观察四周，确认环境和出口。" }),
    ]));
  } else if (type === "random") {
    body.appendChild(scenarioGrid("editor-grid-3", [
      makeScenarioField("随机项名称", "name", data.name || "", { placeholder: "遭遇检定" }),
      makeScenarioField("生效时机", "trigger", data.trigger || "", { placeholder: "夜间探索时" }),
      makeScenarioField("骰子数量", "diceCount", data.diceCount || 1, { type: "number", min: 1, max: 20 }),
      makeScenarioField("骰子面数", "diceSides", data.diceSides || 100, { type: "number", min: 2, max: 1000 }),
      makeScenarioField("修正值", "modifier", data.modifier || 0, { type: "number" }),
      makeScenarioField("补充说明", "note", data.note || "", { multiline: true, placeholder: "这个随机项用于什么情况" }),
    ]));
    const nested = el("div", "editor-nested");
    const nestedHead = el("div", "editor-nested-head");
    nestedHead.appendChild(el("b", "", "随机项结果区间"));
    nestedHead.appendChild(el("span", "", "按掷骰总值判断结果"));
    nested.appendChild(nestedHead);
    const list = el("div", "editor-nested-list");
    list.dataset.nestedList = "randomRange";
    nested.appendChild(list);
    for (const range of data.ranges || []) appendRandomRange(list, range);
    const add = el("button", "editor-add-small", "＋ 添加结果区间");
    add.type = "button";
    add.dataset.randomAddRange = "true";
    nested.appendChild(add);
    body.appendChild(nested);
  } else {
    body.appendChild(scenarioGrid("editor-grid-2", [
      makeScenarioField("选项文字", "text", data.text || "", { placeholder: "从后门潜入" }),
      makeScenarioField("既定后果", "result", data.result || "", { multiline: true, placeholder: "进入后门场景，并触发……" }),
    ]));
  }
  card.appendChild(body);
  return card;
}

function addScenarioRow(type, data = {}, collapsed = false) {
  const meta = SCENARIO_ROW_META[type];
  const container = meta && $(meta.container);
  if (!container) return null;
  const card = buildScenarioRow(type, data, collapsed);
  container.appendChild(card);
  updateScenarioEditorCounts();
  refreshScenarioRowHead(card, type);
  return card;
}

function renderScenarioRows(type, rows) {
  const meta = SCENARIO_ROW_META[type];
  const container = meta && $(meta.container);
  if (!container) return;
  container.innerHTML = "";
  for (const row of rows || []) container.appendChild(buildScenarioRow(type, row, true));
  updateScenarioEditorCounts();
}

function getRowField(card, name) {
  return card.querySelector(`[data-field="${name}"]`);
}

function rowValue(card, name) {
  const field = getRowField(card, name);
  return field ? field.value : "";
}

function rowChecked(card, name) {
  const field = getRowField(card, name);
  return Boolean(field && field.checked);
}

function collectNested(card, type) {
  const list = card.querySelector(`[data-nested-list="${type}"]`);
  if (!list) return [];
  return [...list.querySelectorAll(":scope > [data-nested-row]")].map((row) => {
    const item = {};
    row.querySelectorAll("[data-field]").forEach((field) => {
      if (field.type === "checkbox") item[field.dataset.field] = field.checked;
      else if (field.type === "number") item[field.dataset.field] = Number(field.value) || 0;
      else item[field.dataset.field] = field.value;
    });
    return item;
  });
}

function collectScenarioRows(type) {
  const meta = SCENARIO_ROW_META[type];
  const container = meta && $(meta.container);
  if (!container) return [];
  return [...container.querySelectorAll(":scope > .editor-repeat-card")].map((card) => {
    if (type === "npc") {
      return {
        name: rowValue(card, "name"),
        faction: rowValue(card, "faction"),
        role: rowValue(card, "role"),
        attitude: rowValue(card, "attitude"),
        desc: rowValue(card, "desc"),
        secret: rowValue(card, "secret"),
      };
    }
    if (type === "clue") return { category: rowValue(card, "category"), text: rowValue(card, "text") };
    if (type === "schedule") {
      return {
        at: rowValue(card, "at"),
        title: rowValue(card, "title"),
        note: rowValue(card, "note"),
      };
    }
    if (type === "ending") return { name: rowValue(card, "name"), condition: rowValue(card, "condition") };
    if (type === "entity") {
      return {
        group: rowValue(card, "group"),
        name: rowValue(card, "name"),
        kind: rowValue(card, "kind"),
        info: rowValue(card, "info"),
        initial: rowValue(card, "initial"),
        summary: rowValue(card, "summary"),
        setting: rowValue(card, "setting"),
        rules: rowValue(card, "rules"),
        isPlayer: rowChecked(card, "isPlayer"),
        hidden: rowChecked(card, "hidden"),
        visible: rowChecked(card, "visible"),
        attributes: collectNested(card, "entityAttr"),
      };
    }
    if (type === "status") {
      return {
        name: rowValue(card, "name"),
        initial: rowValue(card, "initial"),
        expiresAt: rowValue(card, "expiresAt"),
        desc: rowValue(card, "desc"),
      };
    }
    if (type === "loop") {
      return {
        every: rowValue(card, "every"),
        title: rowValue(card, "title"),
        nextAt: rowValue(card, "nextAt"),
        expiresAt: rowValue(card, "expiresAt"),
        note: rowValue(card, "note"),
      };
    }
    if (type === "plot") {
      return {
        title: rowValue(card, "title"),
        at: rowValue(card, "at"),
        effect: rowValue(card, "effect"),
        note: rowValue(card, "note"),
      };
    }
    if (type === "lexicon") {
      return {
        path: rowValue(card, "path"),
        term: rowValue(card, "term"),
        def: rowValue(card, "def"),
        visible: rowChecked(card, "visible"),
      };
    }
    if (type === "action") {
      return {
        label: rowValue(card, "label"),
        kind: rowValue(card, "kind"),
        note: rowValue(card, "note"),
        text: rowValue(card, "text"),
      };
    }
    if (type === "random") {
      return {
        name: rowValue(card, "name"),
        trigger: rowValue(card, "trigger"),
        note: rowValue(card, "note"),
        diceCount: Number(rowValue(card, "diceCount")) || 1,
        diceSides: Number(rowValue(card, "diceSides")) || 100,
        modifier: Number(rowValue(card, "modifier")) || 0,
        ranges: collectNested(card, "randomRange"),
      };
    }
    return { text: rowValue(card, "text"), result: rowValue(card, "result") };
  });
}

function updateScenarioEditorCounts() {
  for (const [type, meta] of Object.entries(SCENARIO_ROW_META)) {
    const box = $(meta.container);
    const label = $(meta.count);
    if (!box || !label) continue;
    const count = box.querySelectorAll(":scope > .editor-repeat-card").length;
    label.textContent = `${count} ${meta.noun}`;
  }
  updateScenarioEditorProgress();
}

function updateScenarioEditorProgress() {
  const totalRows = Object.keys(SCENARIO_ROW_META).reduce((sum, type) => sum + collectScenarioRows(type).length, 0);
  const checks = [
    Boolean($("s-title").value.trim()),
    Boolean($("s-genre").value.trim()),
    Boolean($("s-blurb").value.trim()),
    Boolean($("s-background").value.trim()),
    Boolean($("s-world").value.trim()),
    Boolean($("s-opening").value.trim()) || Boolean($("s-hook").value.trim()),
    $("s-rule-dice").checked || $("s-rule-random").checked,
    totalRows > 0,
  ];
  const percent = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  if ($("scenario-edit-progress")) $("scenario-edit-progress").textContent = `${percent}%`;
}

function moveScenarioRow(button, direction) {
  const card = button.closest(".editor-repeat-card");
  if (!card) return;
  if (direction < 0 && card.previousElementSibling) card.parentNode.insertBefore(card, card.previousElementSibling);
  if (direction > 0 && card.nextElementSibling) card.parentNode.insertBefore(card.nextElementSibling, card);
}

function copyScenarioRow(card) {
  if (!card) return;
  const copy = card.cloneNode(true);
  copy.classList.remove("is-collapsed");
  card.parentNode.insertBefore(copy, card.nextElementSibling);
  updateScenarioEditorCounts();
}

function fillScenarioForm(s) {
  $("s-title").value = s.title || "";
  $("s-genre").value = s.genre || "";
  $("s-blurb").value = s.blurb || "";
  $("s-tone").value = s.tone || "";
  $("s-play-style").value = s.playStyle === "open-world" ? "open-world" : "content";
  $("s-version").value = s.version || "1.0";
  $("s-tags").value = (s.tags || []).join(", ");
  $("s-version-note").value = s.versionNote || "";
  $("s-world").value = s.world || "";
  const rules = s.rules || {};
  $("s-rule-dice").checked = rules.diceDefault !== false;
  $("s-rule-dice-toggle").checked = rules.allowDiceToggle !== false;
  $("s-rule-fixed").checked = Boolean(rules.fixedOpeningDefault);
  $("s-rule-fixed-toggle").checked = rules.allowOpeningToggle !== false;
  $("s-rule-random").checked = rules.randomMode !== false;
  $("s-background").value = s.background || "";
  $("s-hook").value = s.hook || "";
  $("s-opening").value = s.opening || "";
  $("s-truth").value = s.truth || "";
  $("s-continuity").value = (Array.isArray(s.continuity) ? s.continuity : []).join("\n");
  $("s-fixed-desc").value = rules.fixedOpeningDesc || s.fixedOpeningDesc || s.fixedOpening?.desc || "";
  const legacyStart = s.startDay || s.startMinute !== undefined
    ? `2026-01-${String(Math.max(1, Number(s.startDay) || 1)).padStart(2, "0")}T${minuteToTime(s.startMinute ?? 540)}`
    : "";
  $("s-start-at").value = dateTimeLocalValue(s.startAt || s.startDateTime || legacyStart);
  $("s-money").value = s.startMoney ?? 0;
  $("s-location").value = s.startLocation || "";
  $("s-items").value = (s.startItems || []).join(", ");

  renderScenarioRows("openingOption", s.openingOptions || s.fixedOpening?.options || []);
  renderScenarioRows("entity", s.entities || []);
  renderScenarioRows("status", s.statuses || []);
  renderScenarioRows("npc", s.npcs || []);
  renderScenarioRows("schedule", s.schedule || []);
  renderScenarioRows("loop", s.loopEvents || []);
  renderScenarioRows("plot", s.plotPoints || []);
  renderScenarioRows("clue", (s.clues || []).map((clue) => (typeof clue === "string" ? { text: clue } : clue)));
  renderScenarioRows("ending", s.endings || []);
  renderScenarioRows("lexicon", s.lexicon || []);
  renderScenarioRows("action", s.actions || []);
  renderScenarioRows("random", s.randomTables || []);

  scenarioLinks = (s.links || []).slice();
  $("s-links").value = "";
  $("s-links-note").textContent = "抓回来的正文会作为设定依据交给 GM";
  renderLinkList("s-links-list", scenarioLinks, "s-links-note");
  updateScenarioEditorCounts();
  updateScenarioPreview();
}

function readScenarioForm() {
  return {
    title: $("s-title").value,
    genre: $("s-genre").value,
    blurb: $("s-blurb").value,
    tone: $("s-tone").value,
    playStyle: $("s-play-style").value,
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
      fixedOpeningDesc: $("s-fixed-desc").value,
    },
    background: $("s-background").value,
    hook: $("s-hook").value,
    opening: $("s-opening").value,
    truth: $("s-truth").value,
    continuity: String($("s-continuity").value || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
    openingOptions: collectScenarioRows("openingOption"),
    entities: collectScenarioRows("entity"),
    statuses: collectScenarioRows("status"),
    npcs: collectScenarioRows("npc"),
    schedule: collectScenarioRows("schedule"),
    loopEvents: collectScenarioRows("loop"),
    plotPoints: collectScenarioRows("plot"),
    clues: collectScenarioRows("clue"),
    endings: collectScenarioRows("ending"),
    lexicon: collectScenarioRows("lexicon"),
    actions: collectScenarioRows("action"),
    randomTables: collectScenarioRows("random"),
    startAt: $("s-start-at").value,
    startMoney: Number($("s-money").value) || 0,
    startLocation: $("s-location").value,
    startItems: String($("s-items").value || "")
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean),
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

function resetScenarioEditor() {
  for (const id of ["s-title", "s-genre", "s-blurb", "s-tone", "s-version-note", "s-background", "s-hook", "s-opening", "s-truth", "s-continuity", "s-world", "s-fixed-desc", "s-location", "s-items", "s-links"]) {
    $(id).value = "";
  }
  $("s-version").value = "1.0";
  $("s-tags").value = "";
  $("s-play-style").value = "open-world";
  $("s-start-at").value = "2026-01-01T18:00";
  $("s-money").value = "100";
  $("s-rule-dice").checked = true;
  $("s-rule-dice-toggle").checked = true;
  $("s-rule-fixed").checked = false;
  $("s-rule-fixed-toggle").checked = true;
  $("s-rule-random").checked = true;
  for (const type of Object.keys(SCENARIO_ROW_META)) renderScenarioRows(type, []);
  addScenarioRow("entity", {
    group: "人物",
    name: "玩家角色",
    kind: "玩家",
    info: "由玩家在开局阶段设定的主角",
    initial: "正常",
    summary: "剧本世界的行动中心",
    setting: "身份、背景和动机由玩家角色卡确定。",
    rules: "行动会改变状态、关系和剧情进度。",
    isPlayer: true,
    visible: true,
    attributes: [
      { group: "基础属性", name: "生命", initial: "100", rule: "降至 0 时进入濒危或结局判定" },
      { group: "基础属性", name: "意志", initial: "50", rule: "受到精神冲击时下降" },
    ],
  }, false).classList.remove("is-collapsed");
  addScenarioRow("action", { label: "观察四周", kind: "investigate", note: "确认环境、人物和可用线索", text: "我先观察四周，确认环境、人物和出口。" }, true);
  scenarioLinks = [];
  renderLinkList("s-links-list", scenarioLinks, "s-links-note");
  updateScenarioEditorCounts();
  updateScenarioPreview();
}

function openScenarioEditor() {
  $("custom-box").classList.remove("hidden");
  $("editor-main")?.scrollTo?.({ top: 0 });
  $("scenario-editor-sections").scrollTop = 0;
  updateScenarioPreview();
}

function closeScenarioEditor() {
  $("custom-box").classList.add("hidden");
  $("scenario-note").textContent = "";
}

$("btn-custom-scenario").addEventListener("click", () => {
  setupState.editingId = null;
  resetScenarioEditor();
  openScenarioEditor();
  $("scenario-note").textContent = "分层创作台已打开；保存后会出现在上面的剧本列表里。";
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
  const npcs = collectScenarioRows("npc").length;
  const clues = collectScenarioRows("clue").length;
  const schedule = collectScenarioRows("schedule").length;
  const endings = collectScenarioRows("ending").length;
  const entities = collectScenarioRows("entity").length;
  const statuses = collectScenarioRows("status").length;
  const loops = collectScenarioRows("loop").length;
  const plots = collectScenarioRows("plot").length;
  const lexicon = collectScenarioRows("lexicon").length;
  const actions = collectScenarioRows("action").length;
  const randoms = collectScenarioRows("random").length;
  box.innerHTML =
    `<div class="sp-title">${escHtml(title)}</div>` +
    `<div class="sp-genre">v${escHtml(version)} · ${escHtml(genre)}${tags ? " · " + escHtml(tags) : ""}</div>` +
    `<div class="sp-blurb">${escHtml(blurb)}</div>` +
    `<div class="sp-meta">人物 ${npcs} · 实体 ${entities} · 状态 ${statuses} · 线索 ${clues}</div>` +
    `<div class="sp-meta">时间节点 ${schedule} · 循环事件 ${loops} · 剧情点 ${plots} · 结局 ${endings}</div>` +
    `<div class="sp-meta">词条 ${lexicon} · 预设行动 ${actions} · 随机项 ${randoms} · 参考链接 ${scenarioLinks.length}</div>`;
}

for (const section of document.querySelectorAll(".editor-section")) {
  section.addEventListener("toggle", () => {
    const state = section.querySelector("[data-section-state]");
    if (state) state.textContent = section.open ? "已开启" : "已收起";
  });
}

const scenarioEditorSections = $("scenario-editor-sections");
scenarioEditorSections.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add-row]");
  if (add) {
    addScenarioRow(add.dataset.addRow, {}, false);
    return;
  }
  const remove = event.target.closest("[data-nested-remove]");
  if (remove) {
    const nested = remove.closest("[data-nested-row]");
    if (nested) nested.remove();
    updateScenarioEditorCounts();
    updateScenarioPreview();
    return;
  }
  const attrAdd = event.target.closest("[data-entity-add-attr]");
  if (attrAdd) {
    const list = attrAdd.closest(".editor-nested")?.querySelector('[data-nested-list="entityAttr"]');
    if (list) appendEntityAttribute(list);
    return;
  }
  const rangeAdd = event.target.closest("[data-random-add-range]");
  if (rangeAdd) {
    const list = rangeAdd.closest(".editor-nested")?.querySelector('[data-nested-list="randomRange"]');
    if (list) appendRandomRange(list);
    return;
  }
  const rowAction = event.target.closest("[data-row-action]");
  if (!rowAction) return;
  const card = rowAction.closest(".editor-repeat-card");
  if (!card) return;
  const action = rowAction.dataset.rowAction;
  if (action === "toggle") {
    card.classList.toggle("is-collapsed");
    rowAction.closest(".editor-repeat-head")?.classList.toggle("is-collapsed", card.classList.contains("is-collapsed"));
    return;
  }
  if (action === "up" || action === "down") {
    moveScenarioRow(rowAction, action === "up" ? -1 : 1);
    updateScenarioPreview();
    return;
  }
  if (action === "copy") {
    copyScenarioRow(card);
    updateScenarioPreview();
    return;
  }
  if (action === "remove") {
    card.remove();
    updateScenarioEditorCounts();
    updateScenarioPreview();
  }
});

function handleScenarioEditorInput(event) {
  const field = event.target.closest("[data-field]");
  if (!field) return;
  const card = field.closest(".editor-repeat-card");
  if (card) refreshScenarioRowHead(card, card.dataset.rowType);
  updateScenarioEditorCounts();
  updateScenarioPreview();
}
scenarioEditorSections.addEventListener("input", handleScenarioEditorInput);
scenarioEditorSections.addEventListener("change", handleScenarioEditorInput);

for (const button of document.querySelectorAll("#scenario-editor-nav [data-editor-target]")) {
  button.addEventListener("click", () => {
    const target = $(button.dataset.editorTarget);
    if (!target) return;
    target.open = true;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelectorAll("#scenario-editor-nav button").forEach((item) => item.classList.remove("on"));
    button.classList.add("on");
  });
}

$("btn-editor-expand").addEventListener("click", () => {
  const sections = [...document.querySelectorAll(".editor-section")];
  const shouldOpen = sections.some((section) => !section.open);
  for (const section of sections) section.open = shouldOpen;
  $("btn-editor-expand").textContent = shouldOpen ? "收起全部" : "展开全部";
});

$("btn-cancel-scenario").addEventListener("click", closeScenarioEditor);
$("btn-cancel-scenario-bottom").addEventListener("click", closeScenarioEditor);

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
  openScenarioEditor();
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

if ($("btn-export-ppt")) $("btn-export-ppt").addEventListener("click", () => {
  if (typeof PptxGenJS === "undefined") {
    alert("PPT 组件还没加载好，等一秒再点，或者刷新页面重试。");
    return;
  }
  const d = readScenarioForm();
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  const title = d.title || "未命名剧本";
  const cover = pptx.addSlide();
  cover.addText(title, { x: 0.5, y: 1.4, w: 9, h: 1, fontSize: 34, bold: true });
  cover.addText(`v${d.version} · ${d.genre} · ${(d.tags || []).join(" / ")}`, { x: 0.5, y: 2.5, w: 9, fontSize: 15 });
  cover.addText(d.blurb || "", { x: 0.5, y: 3.1, w: 9, fontSize: 13 });
  const slide = (heading, body) => {
    if (!body) return;
    const s = pptx.addSlide();
    s.addText(heading, { x: 0.5, y: 0.3, w: 9, fontSize: 20, bold: true });
    s.addText(body, { x: 0.5, y: 1.0, w: 9, h: 4.6, fontSize: 11, valign: "top" });
  };
  slide("世界设定", d.world || d.background || "");
  slide("开局设定", `${String(d.startAt || "").replace("T", " ")}\n${d.hook || ""}\n\n${d.opening || ""}`);
  slide("人物", (d.npcs || []).map((n) => `${n.name}：${n.desc}${n.secret ? "（内情：" + n.secret + "）" : ""}`).join("\n"));
  slide("线索与结局", `线索：\n${(d.clues || []).join("\n")}\n\n结局：\n${(d.endings || []).map((e) => `${e.name}：${e.condition}`).join("\n")}`);
  slide("时间表", (d.schedule || []).map((e) => `${String(e.at || "").replace("T", " ")} ${e.title} ${e.note || ""}`).join("\n"));
  slide("实体与状态", `实体：\n${(d.entities || []).map((e) => `${e.name}｜${e.info}｜初始：${e.initial}｜${e.rules}`).join("\n")}\n\n状态：\n${(d.statuses || []).map((s) => `${s.name} 初始${s.initial}：${s.desc}`).join("\n")}`);
  slide("剧情与词条", `循环事件：\n${(d.loopEvents || []).map((x) => `每 ${x.every} ${x.title}`).join("\n")}\n\n剧情点：\n${(d.plotPoints || []).map((x) => `${x.at || ""} ${x.title}：${x.note || ""}`).join("\n")}\n\n词条：\n${(d.lexicon || []).map((x) => `${x.term}：${x.def}`).join("\n")}`);
  slide("预设行动与规则", `预设行动：${(d.actions || []).map((a) => a.label).join("、")}\n\n规则：默认骰子${d.rules.diceDefault ? "开" : "关"}；可切换骰子${d.rules.allowDiceToggle ? "是" : "否"}；固定开局默认${d.rules.fixedOpeningDefault ? "开" : "关"}；可切换固定开局${d.rules.allowOpeningToggle ? "是" : "否"}；随机机制${d.rules.randomMode ? "开" : "关"}`);
  pptx.writeFile({ fileName: `${title}.pptx` }).catch(() => alert("导出失败，请重试。"));
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
