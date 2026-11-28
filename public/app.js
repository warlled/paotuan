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
const META_CACHE_KEY = "pt-meta-cache-v1";
const SCENARIO_VISIBILITIES_FOR_UI = ["public", "contacts", "private"];
let scenarioLinks = [];
let settingLinks = [];

/**
 * 网络抖动 / 站点重启时的请求包装：
 * - 给请求一个明确上限，避免无限转圈；
 * - 写请求默认不自动重试，防止 AI 已经推演后因响应丢失而重复扣费；
 * - 只有明确指定 retries 的幂等请求才会重试。
 */
async function fetchJsonWithRetry(url, options = {}, { retries = 0, timeout = 175000 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: `服务器返回了异常内容（HTTP ${res.status}）`, status: res.status };
      }
      data.__status = res.status;
      return data;
    } catch (error) {
      lastError = error;
      if (error && error.name === "AbortError") break;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  const timedOut = lastError && lastError.name === "AbortError";
  const friendly = timedOut
    ? new Error("服务器一直没有响应（很可能正在重启，或网络到站点不通）。稍等十几秒后刷新页面再试一次。")
    : new Error("连不上服务器（网络中断，或站点正在重启）。已自动重试仍未成功，请稍后再点一次。");
  friendly.cause = lastError;
  throw friendly;
}
const sharedScenarioId = (() => {
  const queryId = new URLSearchParams(location.search).get("scenario") || "";
  if (queryId) return queryId;
  const match = location.pathname.match(/^\/scenario\/([^/]+)\/?$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
})();
let sharedScenarioPending = Boolean(sharedScenarioId);
let sharedScenarioOpenPending = Boolean(sharedScenarioId);

const setupState = {
  scenarioId: null,
  difficulty: "normal",
  attrs: {},
  editingId: null,
  editorDraftAvailable: false,
};

function selectedScenario() {
  return (meta?.scenarios || []).find((scenario) => scenario.id === setupState.scenarioId) || null;
}

function effectiveMode() {
  return $("mode-select")?.value === "trpg" ? "trpg" : "free";
}

function updateModeControls() {
  const mode = effectiveMode();
  const trpg = mode === "trpg";
  $("difficulty-options")?.classList.toggle("hidden", !trpg);
  $("goal-field")?.classList.toggle("hidden", !trpg);
  $("ability-field")?.classList.toggle("hidden", trpg);
  $("critfail-setting")?.classList.toggle("hidden", !trpg);
  if ($("mode-step-title")) $("mode-step-title").textContent = trpg ? "四、玩法与难度" : "四、玩法";
  const note = $("mode-note");
  if (note) {
    note.textContent = trpg
      ? "当前为跑团规则，难度与目标/动机会参与角色和推演；能力栏不参与跑团规则。"
      : "当前为自由探索，难度与目标/动机已隐藏；可填写角色能力。";
  }
}

function updateScenarioEntry() {
  const scenario = selectedScenario();
  const button = $("enter-scenario");
  if (button) button.disabled = !scenario;
  if ($("entry-scenario-title")) {
    $("entry-scenario-title").textContent = scenario ? scenario.title : "请先选择一个剧本";
  }
  if ($("entry-scenario-meta")) {
    $("entry-scenario-meta").textContent = scenario
      ? [scenario.genre, scenario.duration, scenario.players].filter(Boolean).join(" · ") || "已选择，可进入角色创建"
      : "选中后进入角色创建";
  }
  if (scenario && $("entry-error")) $("entry-error").textContent = "";
}

function openCharacterSetup() {
  const scenario = selectedScenario();
  if (!scenario) {
    $("entry-error").textContent = "请先选择一个剧本。";
    return;
  }
  $("entry-error").textContent = "";
  $("scenario-main").classList.add("hidden");
  $("character-setup").classList.remove("hidden");
  $("character-scenario-title").textContent = scenario.title;
  $("character-scenario-meta").textContent =
    [scenario.genre, scenario.duration, scenario.players, scenario.playStyle === "open-world" ? "开放世界" : "内容剧本"]
      .filter(Boolean)
      .join(" · ");
  $("setup").scrollTop = 0;
  setTimeout(() => $("c-name").focus(), 0);
}

function returnToScenarioList() {
  $("character-setup").classList.add("hidden");
  $("scenario-main").classList.remove("hidden");
  $("setup").scrollTop = 0;
  updateScenarioEntry();
}

function setBottomNavActive(section) {
  document.querySelectorAll("[data-bottom-nav]").forEach((button) => {
    const active = button.dataset.bottomNav === section;
    button.classList.toggle("on", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function closeMainOverlays() {
  closeFeedback();
  document.querySelectorAll(".modal2").forEach((panel) => panel.classList.add("hidden"));
  closeScenarioDetail();
}

function stashEditorDraft() {
  if ($("custom-box").classList.contains("hidden")) return;
  setupState.editorDraftAvailable = true;
  $("custom-box").classList.add("hidden");
}

function showHomeSection() {
  closeMainOverlays();
  stashEditorDraft();
  $("game").classList.remove("on");
  $("setup").classList.remove("hidden");
  $("scenario-main").classList.remove("hidden");
  $("character-setup").classList.add("hidden");
  if (session || meta?.hasSave) {
    bindResumeButton();
    $("resume").classList.remove("hidden");
  }
  $("setup").scrollTo({ top: 0, behavior: "smooth" });
  setBottomNavActive("home");
}

function showCreationSection() {
  closeMainOverlays();
  $("game").classList.remove("on");
  $("setup").classList.remove("hidden");
  $("scenario-main").classList.remove("hidden");
  $("character-setup").classList.add("hidden");
  if (setupState.editorDraftAvailable && $("custom-box").classList.contains("hidden")) {
    openScenarioEditor();
  } else if ($("custom-box").classList.contains("hidden")) {
    startNewScenarioDraft();
  } else openScenarioEditor();
  setBottomNavActive("create");
  $("setup").scrollTo({ top: 0, behavior: "smooth" });
}

function showCommunitySection() {
  closeMainOverlays();
  stashEditorDraft();
  setBottomNavActive("community");
  $("cm-open").click();
}

function showNoticeFeedbackSection() {
  closeMainOverlays();
  stashEditorDraft();
  setBottomNavActive("notice");
  openFeedback("announcements");
}

function showProfileSection() {
  closeMainOverlays();
  stashEditorDraft();
  setBottomNavActive("profile");
  $("me-open").click();
}

document.querySelectorAll("[data-bottom-nav]").forEach((button) => {
  button.addEventListener("click", () => {
    const section = button.dataset.bottomNav;
    if (section === "home") showHomeSection();
    else if (section === "create") showCreationSection();
    else if (section === "community") showCommunitySection();
    else if (section === "notice") showNoticeFeedbackSection();
    else if (section === "profile") showProfileSection();
  });
});

function applyPanelScale(modalId, buttonId, compact) {
  const modal = $(modalId);
  const button = $(buttonId);
  if (!modal || !button) return;
  modal.classList.toggle("compact-view", compact);
  button.textContent = compact ? "全屏" : "缩放";
  button.setAttribute("aria-pressed", compact ? "true" : "false");
}

for (const [modalId, buttonId, key] of [
  ["fb-modal", "fb-scale", "notice"],
  ["me-modal", "me-scale", "profile"],
  ["cm-modal", "cm-scale", "community"],
]) {
  const button = $(buttonId);
  if (!button) continue;
  let compact = false;
  try {
    compact = localStorage.getItem(`pt-panel-${key}-compact`) === "1";
  } catch {}
  applyPanelScale(modalId, buttonId, compact);
  button.addEventListener("click", () => {
    const next = !$(modalId).classList.contains("compact-view");
    applyPanelScale(modalId, buttonId, next);
    try {
      localStorage.setItem(`pt-panel-${key}-compact`, next ? "1" : "0");
    } catch {}
  });
}

function storeScenarioSocial(id, social) {
  const scenario = meta?.scenarios?.find((item) => item.id === id);
  if (scenario) scenario.social = social;
  if (scDetailId === id) renderScenarioSocial(social);
}

async function scenarioSocialAction(path, id) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  if (data.social) storeScenarioSocial(id, data.social);
  renderScenarios(scFilter === "favorites" && !data.social?.favorited ? undefined : id);
  return data;
}

async function shareScenarioPage(id, statusNode = null) {
  const data = await scenarioSocialAction("/api/scenario/forward", id);
  const scenario = scDetailId === id ? scDetailData : (meta?.scenarios || []).find((item) => item.id === id);
  const title = scenario?.title || "剧本";
  if (navigator.share) {
    try {
      await navigator.share({
        title,
        text: `来看看这个剧本：${title}`,
        url: data.shareUrl,
      });
      if (statusNode) statusNode.textContent = "已打开系统分享";
      return data.shareUrl;
    } catch (error) {
      if (error?.name === "AbortError") {
        if (statusNode) statusNode.textContent = "已取消分享";
        return data.shareUrl;
      }
    }
  }
  try {
    await navigator.clipboard.writeText(data.shareUrl);
    if (statusNode) statusNode.textContent = "剧本页面链接已复制";
  } catch {
    prompt("复制这个剧本页面链接：", data.shareUrl);
  }
  return data.shareUrl;
}

async function publishScenarioToCommunity(id, origin = "原创") {
  const response = await fetch("/api/scenario/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, origin }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "发布失败");
  return data;
}

/* ---------- 开局界面 ---------- */

const PAGE_SIZE = 4;
let scFilter = "all";
let scPage = 0;
let scQuery = "";

function scenarioSeries(s) {
  const genre = String(s.genre || "");
  if (/^dc-/i.test(s.id) || /DC/i.test(genre)) return "dc";
  if (/^marvel-/i.test(s.id) || /Marvel|漫威/i.test(genre)) return "marvel";
  return "original";
}

function filteredScenarios() {
  const all = meta?.scenarios || [];
  const byTab = scFilter === "all" ? all : scFilter === "favorites" ? all.filter((s) => s.social?.favorited) : all.filter((s) => scenarioSeries(s) === scFilter);
  const q = scQuery.trim().toLowerCase();
  if (!q) return byTab;
  const terms = q.split(/\s+/).filter(Boolean);
  return byTab.filter((s) => {
    const haystack = String(
      s.searchText ||
        [s.title, s.author, s.genre, s.blurb, (s.tags || []).join(" ")].filter(Boolean).join(" ")
    ).toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
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
    ["favorites", "收藏"],
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
  const linkedScenarioId = selectId || (sharedScenarioPending || sharedScenarioOpenPending ? sharedScenarioId : "");
  if (!selectId && sharedScenarioPending) {
    selectId = sharedScenarioId;
    sharedScenarioPending = false;
  }
  renderScenarioTabs();
  if (!meta) {
    const box = $("scenarios");
    box.innerHTML = "";
    box.appendChild(el("div", "hint", "正在加载剧本…如果长时间没有出现，会自动重试。"));
    $("sc-page").textContent = "正在加载";
    $("sc-prev").disabled = true;
    $("sc-next").disabled = true;
    $("start").disabled = true;
    if ($("enter-scenario")) $("enter-scenario").disabled = true;
    return;
  }
  if (selectId && !filteredScenarios().some((s) => s.id === selectId)) {
    scFilter = "all";
    renderScenarioTabs();
  }
  const list = filteredScenarios();
  if (sharedScenarioOpenPending && !list.some((scenario) => scenario.id === sharedScenarioId)) {
    sharedScenarioOpenPending = false;
  }
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
    const card = el("div", "card");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.dataset.id = s.id;

    const cover = el("div", "c");
    if (s.cover) {
      const img = document.createElement("img");
      img.src = s.cover;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      applyCoverStyle(img, s.coverStyle);
      cover.appendChild(img);
    } else {
      cover.classList.add("c-fallback");
      cover.appendChild(el("span", "c-mark", String(s.title || "?").slice(0, 1)));
    }
    cover.appendChild(el("div", "c-badge", s.playStyle === "open-world" ? "开放世界" : "内容剧本"));
    if (s.visibility === "private") cover.appendChild(el("div", "c-badge c-badge-private", "仅自己"));
    else if (s.visibility === "contacts") cover.appendChild(el("div", "c-badge c-badge-private", "联系人可见"));
    cover.appendChild(el("div", "c-author-badge", `作者 · ${s.author || "匿名作者"}`));
    card.appendChild(cover);

    const body = el("div", "c-body");
    body.appendChild(el("div", "t", s.title));
    const metaLine = [s.genre, s.duration, s.players].filter(Boolean).join(" · ");
    body.appendChild(el("div", "g", metaLine));
    body.appendChild(el("div", "b", s.blurb));
    if (Array.isArray(s.tags) && s.tags.length) {
      const tagRow = el("div", "c-tags");
      for (const tag of s.tags.slice(0, 3)) tagRow.appendChild(el("span", "c-tag", tag));
      body.appendChild(tagRow);
    }
    const foot = el("div", "c-actions");
    const detailBtn = el("button", "c-detail", "详情");
    detailBtn.type = "button";
    detailBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openScenarioDetail(s.id);
    });
    foot.appendChild(detailBtn);
    if (s.editable) foot.appendChild(el("span", "c-author", "可编辑"));
    body.appendChild(foot);
    card.appendChild(body);

    const social = s.social || {};
    const socialBar = el("div", "scenario-card-social");
    const socialButtons = [
      ["like", social.liked ? "♥" : "♡", social.likes || 0, "点赞"],
      ["favorite", social.favorited ? "★" : "☆", social.favorites || 0, "收藏"],
      ["forward", "↗", social.shares || 0, "转发"],
      ["comments", "💬", social.commentCount || 0, "评论"],
    ];
    for (const [kind, icon, count, title] of socialButtons) {
      const button = el("button", "scenario-social-btn" + (social.liked && kind === "like" || social.favorited && kind === "favorite" ? " on" : ""));
      button.type = "button";
      button.title = title;
      button.textContent = `${icon} ${count}`;
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (kind === "comments") return openScenarioDetail(s.id);
        try {
          if (kind === "forward") {
            await shareScenarioPage(s.id);
          } else {
            await scenarioSocialAction(kind === "like" ? "/api/scenario/like" : "/api/scenario/favorite", s.id);
          }
        } catch (error) {
          alert(error.message || error);
        }
      });
      socialBar.appendChild(button);
    }
    card.appendChild(socialBar);

    const selectCard = () => {
      setupState.scenarioId = s.id;
      setupState.editingId = s.editable ? s.id : null;
      [...box.children].forEach((c) => c.classList.remove("on"));
      card.classList.add("on");
      const editable = Boolean(s.editable);
      $("btn-edit-scenario").classList.toggle("hidden", !editable);
      $("btn-del-scenario").classList.toggle("hidden", !editable);
      $("btn-share-scenario").classList.toggle("hidden", !editable);
      $("share-origin").classList.toggle("hidden", !editable);
      updateScenarioEntry();
      updateModeControls();
    };
    card.addEventListener("click", selectCard);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCard();
      }
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
    $("share-origin").classList.add("hidden");
    if (scQuery.trim()) {
      box.appendChild(el("div", "hint", `没有匹配「${scQuery.trim()}」的剧本，换个关键词试试。`));
    }
  }
  if (sharedScenarioOpenPending && setupState.scenarioId === linkedScenarioId) {
    const linkedId = setupState.scenarioId;
    sharedScenarioOpenPending = false;
    setTimeout(() => openScenarioDetail(linkedId), 0);
  }

  if ($("sc-search-info")) {
    $("sc-search-info").textContent = scQuery.trim() ? `找到 ${list.length} 个剧本` : "";
  }
  $("sc-page").textContent = `第 ${scPage + 1} / ${pages} 页`;
  $("sc-prev").disabled = scPage <= 0;
  $("sc-next").disabled = scPage >= pages - 1;
  $("start").disabled = false;
  updateScenarioEntry();
}

let scSearchTimer = 0;
$("sc-search")?.addEventListener("input", (event) => {
  const value = String(event.target.value || "");
  clearTimeout(scSearchTimer);
  scSearchTimer = setTimeout(() => {
    scQuery = value;
    scPage = 0;
    renderScenarios();
  }, 180);
});
$("sc-search")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    clearTimeout(scSearchTimer);
    scQuery = String(event.target.value || "");
    scPage = 0;
    renderScenarios();
  }
});
$("sc-search-clear")?.addEventListener("click", () => {
  clearTimeout(scSearchTimer);
  scQuery = "";
  if ($("sc-search")) $("sc-search").value = "";
  scPage = 0;
  renderScenarios();
});

$("sc-prev").addEventListener("click", () => {
  if (scPage > 0) {
    scPage -= 1;
    renderScenarios();  }
});
$("sc-next").addEventListener("click", () => {
  if (!meta) {
    loadMeta();
    return;
  }
  scPage += 1;
  renderScenarios();
});
$("mode-select").addEventListener("change", updateModeControls);
$("enter-scenario").addEventListener("click", openCharacterSetup);
$("back-to-scenarios").addEventListener("click", returnToScenarioList);
document.addEventListener("keydown", (e) => {
  if ($("setup")?.classList.contains("hidden")) return;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  if (e.key === "ArrowLeft" && !$("sc-prev").disabled) $("sc-prev").click();
  if (e.key === "ArrowRight" && !$("sc-next").disabled) $("sc-next").click();
});
document.addEventListener("keydown", (event) => {
  if (!$("game")?.classList.contains("on")) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  if (event.key === "ArrowLeft" && !$("turn-prev").disabled) $("turn-prev").click();
  if (event.key === "ArrowRight" && !$("turn-next").disabled) $("turn-next").click();
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

function readMetaCache() {
  try {
    const data = JSON.parse(localStorage.getItem(META_CACHE_KEY) || "null");
    if (data && Array.isArray(data.scenarios) && data.difficulty && Array.isArray(data.attrs)) return data;
  } catch {}
  return null;
}

function bindResumeButton() {
  const button = $("resume");
  if (!button || button.dataset.ptBound) return;
  button.dataset.ptBound = "1";
  button.addEventListener("click", async () => {
    const r = await fetch("/api/state");
    const data = await r.json();
    if (!data.session) {
      button.classList.add("hidden");
      return;
    }
    showSession(data.session);
    setBottomNavActive("home");
  });
}

let homeMpBound = false;

function roomAttrPayload() {
  const out = {};
  for (const key of ["str", "dex", "con", "int", "per", "cha"]) {
    out[key] = Math.max(1, Math.min(10, Number($(`home-mp-${key}`)?.value) || 5));
  }
  return out;
}

function updateHomeMpPool() {
  const total = Object.values(roomAttrPayload()).reduce((sum, value) => sum + value, 0);
  const box = $("home-mp-pool");
  if (!box) return total;
  box.textContent = `属性总和 ${total} / 30（需要 24–30）`;
  box.classList.toggle("over", total < 24 || total > 30);
  return total;
}

function renderHomeMpAttrs() {
  const box = $("home-mp-attrs");
  if (!box || box.dataset.ready) return;
  box.dataset.ready = "1";
  for (const [key, label] of [["str","力量"],["dex","敏捷"],["con","体质"],["int","智力"],["per","感知"],["cha","魅力"]]) {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const input = document.createElement("input");
    input.id = `home-mp-${key}`;
    input.type = "number";
    input.min = "1";
    input.max = "10";
    input.value = "5";
    input.addEventListener("input", updateHomeMpPool);
    wrap.appendChild(input);
    box.appendChild(wrap);
  }
  updateHomeMpPool();
}

function renderHomeMpScenarios() {
  const picker = $("home-mp-scenario");
  if (!picker || !meta?.scenarios) return;
  const previous = picker.value;
  picker.innerHTML = "";
  for (const scenario of meta.scenarios) {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = `${scenario.title}${scenario.genre ? `（${scenario.genre}）` : ""}`;
    picker.appendChild(option);
  }
  if ([...picker.options].some((option) => option.value === previous)) picker.value = previous;
  renderHomeMpSummary();
}

function renderHomeMpSummary() {
  const picker = $("home-mp-scenario");
  const box = $("home-mp-summary");
  if (!picker || !box) return;
  const scenario = meta?.scenarios?.find((item) => item.id === picker.value);
  box.textContent = scenario
    ? `${scenario.genre || "原创"} · ${scenario.players || "2–6 人"} · ${scenario.blurb || "暂无简介"}`
    : "选择剧本后会显示类型、简介和推荐人数。";
}

function initHomeMultiplayer(data) {
  if (!$("home-mp")) return;
  renderHomeMpAttrs();
  meta = data;
  renderHomeMpScenarios();
  if (homeMpBound) return;
  homeMpBound = true;
  $("home-mp-scenario").addEventListener("change", renderHomeMpSummary);
  $("home-mp-visibility").addEventListener("change", () => {
    $("home-mp-password-wrap").classList.toggle("hidden", $("home-mp-visibility").value !== "password");
  });
  $("home-mp-submit").addEventListener("click", async () => {
    const status = $("home-mp-status");
    const name = $("home-mp-name").value.trim();
    const total = updateHomeMpPool();
    if (!$("home-mp-scenario").value) return void (status.textContent = "请选择剧本。");
    if (!name) return void (status.textContent = "请填写角色名。");
    if (total < 24 || total > 30) return void (status.textContent = "属性总和需要在 24–30 之间。");
    if ($("home-mp-visibility").value === "password" && $("home-mp-password").value.length < 4) {
      return void (status.textContent = "密码房至少需要 4 个字符。");
    }
    $("home-mp-submit").disabled = true;
    status.textContent = "正在创建多人房间…";
    try {
      const response = await fetch("/api/rooms/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: $("home-mp-scenario").value,
          mode: $("home-mp-mode").value,
          difficulty: $("home-mp-difficulty").value,
          visibility: $("home-mp-visibility").value,
          password: $("home-mp-password").value,
          maxPlayers: Number($("home-mp-max").value),
          roundSeconds: Number($("home-mp-round").value),
          allowSpectators: $("home-mp-spectators").checked,
          autoAdvance: $("home-mp-auto").checked,
          opening: $("home-mp-opening").value,
          language: window.PT_I18N?.getLanguage() || "zh-Hans",
          character: {
            name,
            role: $("home-mp-role").value,
            bio: $("home-mp-bio").value,
            appearance: $("home-mp-appearance").value,
            personality: $("home-mp-personality").value,
            ability: $("home-mp-ability").value,
            goal: $("home-mp-goal").value,
            attrs: roomAttrPayload(),
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "创建失败");
      status.textContent = "房间已创建，正在进入…";
      const roomPath = result.room.visibility === "invite" && result.room.invitePath
        ? result.room.invitePath
        : `/room?code=${encodeURIComponent(result.code)}`;
      location.href = roomPath;
    } catch (error) {
      status.textContent = error.message || String(error);
    } finally {
      $("home-mp-submit").disabled = false;
    }
  });
}

function applyMetaData(data, cached = false) {
  meta = data;
  applyDefaultModelLabel(data.model, data.modelLabel);
  renderScenarios();
  renderDiffs();
  renderAttrs();
  renderPresets();
  initHomeMultiplayer(data);
  fillSettings();
  $("set-length").innerHTML = "";
  $("roll-skill").innerHTML = "";
  for (const name of meta.narrativeLengths || []) {
    const opt = el("option", "", `${name}篇幅`);
    opt.value = name;
    $("set-length").appendChild(opt);
  }
  for (const s of meta.skills || []) {
    const attr = (meta.attrs || []).find((a) => a.key === s.attr);
    const opt = el("option", "", `${s.name}（${attr?.label || s.attr}）`);
    opt.value = s.name;
    $("roll-skill").appendChild(opt);
  }
  if (!cached) {
    try {
      localStorage.setItem(META_CACHE_KEY, JSON.stringify(data));
    } catch {}
  }

  if (meta.hasSave) {
    bindResumeButton();
    $("resume").classList.remove("hidden");
  }

  if (meta.isOwner === false) {
    $("btn-quit").classList.add("hidden");
    $("settings-sect")?.classList.add("hidden");
    document.querySelector('#side-tabs button[data-side-tab="settings"]')?.classList.add("hidden");
    if (activeSideTab === "settings") applySideTab("player");
    const sub = document.querySelector(".setup-sub");
    if (sub && !$("guest-limit-hint")) {
      sub.insertAdjacentHTML(
        "beforeend",
        `<div id="guest-limit-hint" style="margin-top:8px;color:#c8a06a">你是访客：这一局最多 ${meta.guestTurnLimit || 60} 回合，进度只保存在你自己的浏览器里。</div>`
      );
    }
  }

  if (meta.isOwner === true && meta.siteOpen === false && !document.querySelector(".owner-closed-banner")) {
    const bar = document.createElement("div");
    bar.className = "owner-closed-banner";
    bar.textContent = "入口已关闭：你是房主所以仍可进入，访客会看到“今日暂停营业”。";
    document.body.prepend(bar);
  }
}

async function loadMeta() {
  if (metaLoading || meta) return;
  metaLoading = true;
  clearTimeout(metaRetryTimer);
  const cached = readMetaCache();
  if (cached) applyMetaData(cached, true);
  else renderScenarios();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let data;
    try {
      const res = await fetch("/api/meta", { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    if (!Array.isArray(data.scenarios) || !data.difficulty || !Array.isArray(data.attrs)) {
      throw new Error("返回数据不完整");
    }
    applyMetaData(data);
  } catch (err) {
    if (!meta) {
      const box = $("scenarios");
      box.innerHTML = "";
      box.appendChild(el("div", "err", `剧本加载失败：${err.message || err}。3 秒后自动重试。`));
      $("sc-page").textContent = "加载失败";
      $("start").disabled = true;
    }
    const delay = meta ? 15000 : 3000;
    metaRetryTimer = setTimeout(() => {
      metaLoading = false;
      if (meta) meta = null;
      loadMeta();
    }, delay);
    return;
  } finally {
    metaLoading = false;
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
    goal: effectiveMode() === "trpg" ? $("c-goal").value : "",
    ability: effectiveMode() === "free" ? $("c-ability").value : "",
    attrs: setupState.attrs,
  };
  if (!character.name.trim()) {
    $("err").textContent = "先给角色起个名字。";
    return;
  }
  $("start").disabled = true;
  $("start").textContent = "正在开幕…";
  try {
    const data = await fetchJsonWithRetry(
      "/api/new",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          character,
          scenarioId: setupState.scenarioId,
          difficulty: setupState.difficulty,
          mode: $("mode-select")?.value || "free",
          language: currentUiLanguage(),
          protocol: protocolState.enabled ? protocolRules() : [],
        }),
      },
      { retries: 0, timeout: 175000 }
    );
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
    appendSegment({
      type: "sys",
      text:
        session.mode === "free"
          ? `${session.scenario.title} · 自由探索开始`
          : `${session.scenario.title} · ${meta.difficulty[session.difficulty].label}难度 · 游戏开始`,
    }, true);
    (data.segments || []).forEach(appendSegment);
    renderTurnView(-1, true);
    showOpening();
  } catch (e) {
    const message = String((e && e.message) || e || "");
    $("err").textContent = /连不上服务器|没有响应/.test(message) ? message : "启动失败：" + message;
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
    row.appendChild(el("div", "seg-label", session?.mode === "free" ? "我的选择" : "我的行动"));
    row.appendChild(el("div", "b", seg.text));
  } else if (seg.type === "gm") {
    row.appendChild(el("div", "gm-text", seg.text));
    if (Array.isArray(seg.suggestions) && seg.suggestions.length) {
      const card = el("div", "suggestions-card");
      card.appendChild(el("div", "suggestions-title", session?.mode === "free" ? "探索方向" : "推荐行动"));
      seg.suggestions.forEach((text, index) => {
        const button = el("button", "suggestion-action");
        button.type = "button";
        button.dataset.action = text;
        button.appendChild(el("span", "suggestion-no", String(index + 1)));
        button.appendChild(el("span", "suggestion-text", text));
        card.appendChild(button);
      });
      row.appendChild(card);
    }
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

let historyReadonly = false;
let currentTurnView = 0;
let turnGroupsCache = [];
let turnGroupsCacheKey = "";

function buildTurnGroups(source) {
  const groups = [];
  let group = null;
  let lastExplicitTurn = null;
  for (const entry of source?.log || []) {
    const explicitTurn = Number.isInteger(entry?.turn) ? entry.turn : null;
    const startsExplicitGroup = explicitTurn !== null && explicitTurn !== lastExplicitTurn;
    if (entry.type === "player" || startsExplicitGroup) {
      group = {
        turn: explicitTurn !== null ? explicitTurn : groups.filter((item) => item.turn > 0).length + 1,
        entries: [],
      };
      groups.push(group);
    } else if (!group) {
      group = { turn: 0, entries: [] };
      groups.push(group);
    }
    if (explicitTurn !== null) lastExplicitTurn = explicitTurn;
    group.entries.push(entry);
  }
  return groups;
}

function compactClock(value) {
  const text = String(value || "").trim();
  const chinese = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/);
  if (chinese) {
    return `${chinese[1]}.${chinese[2].padStart(2, "0")}.${chinese[3].padStart(2, "0")} · ${chinese[4].padStart(2, "0")}:${chinese[5]}`;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}.${iso[2]}.${iso[3]} · ${iso[4]}:${iso[5]}`;
  return text;
}

function turnGroupClock(group, groups) {
  const timedEntry = group?.entries?.find((entry) => entry?.at);
  if (timedEntry?.at) return compactClock(timedEntry.at);
  if (group?.turn === 0) return compactClock(session?.openingAt);
  const fromTurnTimes = session?.turnTimes?.[String(group?.turn)];
  if (fromTurnTimes) return compactClock(fromTurnTimes);
  const fromHistory = [...(session?.history || []), ...(session?.eventLog || [])]
    .find((entry) => Number(entry?.turn) === Number(group?.turn) && entry?.at);
  if (fromHistory?.at) return compactClock(fromHistory.at);
  const latestTurn = Math.max(0, ...(groups || []).map((item) => Number(item.turn) || 0));
  if (Number(group?.turn) === latestTurn) return compactClock(session?.clock);
  return "";
}

function renderTurnView(index, keepBottom = false) {
  if (!session) {
    turnGroupsCache = [];
    turnGroupsCacheKey = "";
    $("turn-indicator").textContent = "尚无回合";
    $("turn-prev").disabled = true;
    $("turn-next").disabled = true;
    return;
  }
  const nextTurnGroupsKey = [
    session.turns || 0,
    session.log?.length || 0,
    session.openingAt || "",
    session.createdAt || "",
  ].join("|");
  if (nextTurnGroupsKey !== turnGroupsCacheKey) {
    turnGroupsCache = buildTurnGroups(session);
    turnGroupsCacheKey = nextTurnGroupsKey;
  }
  if (!turnGroupsCache.length) {
    const opening = {
      turn: 0,
      entries: [{ type: "gm", text: session.opening || "等待第一回合…" }],
    };
    turnGroupsCache = [opening];
  }
  currentTurnView =
    index === -1 || index == null
      ? turnGroupsCache.length - 1
      : Math.max(0, Math.min(turnGroupsCache.length - 1, Number(index) || 0));
  const active = turnGroupsCache[currentTurnView];
  $("log").innerHTML = "";
  const heading = el("div", "turn-heading");
  heading.appendChild(
    el("span", "turn-heading-no", active.turn ? (session?.mode === "free" ? `探索 ${active.turn}` : `第 ${active.turn} 回合`) : "开场")
  );
  heading.appendChild(
    el(
      "span",
      "turn-heading-title",
      session?.mode === "free" ? (active.turn ? "探索记录" : "世界从这里展开") : active.turn ? "叙事记录" : "故事从这里开始"
    )
  );
  const turnClock = turnGroupClock(active, turnGroupsCache);
  if (turnClock) {
    const clock = el("span", "turn-heading-time", turnClock);
    clock.title = active.entries.find((entry) => entry?.at)?.at || session.openingAt || session.clock || turnClock;
    heading.appendChild(clock);
  }
  $("log").appendChild(heading);
  active.entries.forEach((entry) => appendSegment(entry, true));
  $("turn-indicator").textContent = active.turn
    ? session?.mode === "free"
      ? `探索 ${active.turn} / ${turnGroupsCache.filter((item) => item.turn > 0).length}`
      : `第 ${active.turn} / ${turnGroupsCache.filter((item) => item.turn > 0).length} 回合`
    : "开场";
  $("turn-prev").disabled = currentTurnView <= 0;
  $("turn-next").disabled = currentTurnView >= turnGroupsCache.length - 1;
  historyReadonly = currentTurnView < turnGroupsCache.length - 1;
  $("input").readOnly = historyReadonly;
  $("input").placeholder = historyReadonly
    ? "正在回看旧回合；回到最新回合后才能继续行动。"
    : "你要做什么？（Enter 发送，Shift+Enter 换行）";
  $("send").disabled = historyReadonly || busy || Boolean(session.ended);
  $("turn-latest").disabled = !historyReadonly;
  document.querySelectorAll("#log .suggestion-action").forEach((button) => {
    button.disabled = historyReadonly || busy || Boolean(session.ended);
  });
  if (keepBottom && !historyReadonly) scrollLog(true);
  archiveSearch();
}

$("turn-prev").addEventListener("click", () => renderTurnView(currentTurnView - 1));
$("turn-next").addEventListener("click", () => renderTurnView(currentTurnView + 1));
$("turn-latest").addEventListener("click", () => renderTurnView(-1, true));
$("log").addEventListener("click", (event) => {
  const button = event.target.closest(".suggestion-action");
  if (button?.dataset.action) act(button.dataset.action);
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

function renderResearchStatus() {
  const status = $("research-status");
  const box = $("research-sources");
  if (!status || !box) return;
  box.innerHTML = "";
  const info = session?.research;
  if (!info) {
    status.textContent = "当前没有联网校准记录；开始游戏后会按可信来源自动核验。";
    return;
  }
  if (!info.sources?.length) {
    status.textContent = `校准失败或没有通过审核的来源。${info.error || "将仅使用剧本本地资料和本局历史。"}`;
    return;
  }
  const time = info.fetchedAt ? new Date(info.fetchedAt).toLocaleString("zh-CN") : "时间未知";
  status.textContent = `已核验 ${info.sources.length} 个来源 · ${time}${info.stale ? " · 当前使用最近缓存" : ""}`;
  for (const source of info.sources) {
    const link = document.createElement("a");
    link.className = "research-source";
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const title = document.createElement("b");
    title.textContent = `${source.authority || "参考"} · ${source.title || source.label || "资料来源"}`;
    link.append(title, document.createTextNode(`\n抓取：${source.fetchedAt ? new Date(source.fetchedAt).toLocaleString("zh-CN") : "未知"} · ${source.chars || 0} 字`));
    box.appendChild(link);
  }
}

function statBar(sel, value, max) {
  $(sel + "-text").textContent = `${value} / ${max}`;
  $(sel + "-fill").style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
}

function renderSession() {
  if (!session) return;
  applyScenarioVisual(session.scenario?.visual);
  const c = session.character;
  $("pc-name").textContent = c.name;
  $("pc-sub").textContent = [c.gender, c.age ? `${c.age} 岁` : "", c.role].filter(Boolean).join(" · ");
  const freeMode = session.mode === "free";
  if ($("hp-label")) $("hp-label").textContent = "生命";
  if ($("san-label")) $("san-label").textContent = freeMode ? "精神" : "理智";
  $("skill-sect")?.classList.toggle("hidden", freeMode);
  $("roll-sect")?.classList.toggle("hidden", freeMode);
  statBar("hp", session.status.hp, session.status.hpMax);
  statBar("san", session.status.san, session.status.sanMax);
  $("money").textContent = String(session.status.money);
  $("turns").textContent = `${session.turns || 0} 回合`;
  const vitals = $("mobile-vitals");
  if (vitals) vitals.textContent = `♥ ${session.status.hp}/${session.status.hpMax} · ◇ ${session.status.san}/${session.status.sanMax}`;

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
  const ability = String(c.ability || "").trim();
  $("ability-sect")?.classList.toggle("hidden", session.mode !== "free" || !ability);
  if ($("character-ability")) $("character-ability").textContent = ability;

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
  const seenEvents = new Set();
  const events = [...(session.eventLog || []), ...(session.history || [])]
    .filter((event) => {
      const title = String(event?.title || event?.text || "").trim();
      if (!title) return false;
      const key = `${event.at || ""}|${title}|${event.note || ""}`;
      if (seenEvents.has(key)) return false;
      seenEvents.add(key);
      return true;
    })
    .slice(-20)
    .reverse();
  if (!events.length) evBox.appendChild(el("div", "hint", "（重要经历会随着你的行动在这里形成）"));
  for (const e of events) {
    const row = el("div", "row done");
    row.appendChild(el("div", "when", e.at || "时间未记录"));
    row.appendChild(el("div", "", e.title || e.text));
    if (e.note) row.appendChild(el("div", "hint", e.note));
    evBox.appendChild(row);
  }

  const worldStyle = session.mode === "free" ? "自由探索" : session.scenario?.playStyle === "open-world" ? "开放世界" : "";
  $("tb-title").textContent = `${session.scenario.title} · ${c.name}${worldStyle ? " · " + worldStyle : ""}`;
  $("tb-clock").textContent = compactClock(session.clock);
  $("tb-clock").title = session.clock || "";
  if ($("turn-prev")) $("turn-prev").textContent = freeMode ? "‹ 上一段" : "‹ 上回合";
  if ($("turn-next")) $("turn-next").textContent = freeMode ? "下一段 ›" : "下回合 ›";
  renderResearchStatus();
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

let busyStartedAt = 0;
let busyTicker = null;

function setBusy(on, note) {
  busy = on;
  clearInterval(busyTicker);
  busyTicker = null;
  $("send").disabled = on || Boolean(session?.ended) || historyReadonly;
  $("input").disabled = on || Boolean(session?.ended);
  document.querySelectorAll("#log .suggestion-action").forEach((button) => {
    button.disabled = on || Boolean(session?.ended) || historyReadonly;
  });
  if (!on) {
    $("thinking")?.remove();
    return;
  }
  if (!note) return;
  const row = el("div", "seg gm busy");
  row.id = "thinking";
  row.setAttribute("aria-live", "polite");
  const dot = el("span", "busy-dot");
  const text = el("span", "busy-text", note === "……" ? "正在推演这一回合" : note);
  const timer = el("span", "busy-timer", "刚刚开始");
  timer.setAttribute("aria-hidden", "true");
  row.append(dot, text, timer);
  $("log").appendChild(row);
  busyStartedAt = Date.now();
  const updateBusyProgress = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - busyStartedAt) / 1000));
    const stage =
      seconds < 4
        ? "正在理解你的行动与当前局面"
        : seconds < 12
          ? "正在推演人物反应、事件与后果"
          : seconds < 30
            ? "正在核对属性、关系和时间线"
            : "内容较长，仍在生成，请保持页面开启";
    if (text.textContent !== stage) text.textContent = stage;
    timer.textContent = seconds < 1 ? "刚刚开始" : `已等待 ${seconds} 秒`;
  };
  updateBusyProgress();
  busyTicker = setInterval(updateBusyProgress, 1000);
  scrollLog();
}

let pendingProtocolAction = "";

function openProtocolConfirmation(action) {
  pendingProtocolAction = action;
  const list = $("protocol-confirm-list");
  list.innerHTML = "";
  for (const rule of protocolRules()) list.appendChild(el("div", "protocol-item", rule));
  $("protocol-confirm-check").checked = false;
  $("protocol-confirm").disabled = true;
  $("protocol-modal").classList.remove("hidden");
}

async function act(text) {
  if (historyReadonly || !text.trim() || busy || session?.ended) return;
  if (shouldConfirmProtocol()) {
    openProtocolConfirmation(text);
    return;
  }
  await submitAction(text);
}

/** 协议弹窗默认只在本局第一次行动前出现，之后不再打断；玩家可在右侧「协议」里改。 */
const PROTOCOL_CONFIRM_KEY = "pt-protocol-confirmed-run";
let protocolConfirmedRun = "";

function protocolRunKey() {
  return String(session?.createdAt || session?.openingAt || "run");
}

function protocolAlreadyConfirmed() {
  const key = protocolRunKey();
  if (protocolConfirmedRun === key) return true;
  try {
    return localStorage.getItem(PROTOCOL_CONFIRM_KEY) === key;
  } catch {
    return false;
  }
}

function markProtocolConfirmed() {
  const key = protocolRunKey();
  protocolConfirmedRun = key;
  try {
    localStorage.setItem(PROTOCOL_CONFIRM_KEY, key);
  } catch {}
}

function shouldConfirmProtocol() {
  if (!protocolState.enabled) return false;
  const mode = protocolState.confirmMode || "first";
  if (mode === "never") return false;
  if (mode === "always") return true;
  return !protocolAlreadyConfirmed();
}

$("protocol-confirm-check").addEventListener("change", () => {
  $("protocol-confirm").disabled = !$("protocol-confirm-check").checked;
});
$("protocol-cancel").addEventListener("click", () => {
  pendingProtocolAction = "";
  $("protocol-modal").classList.add("hidden");
});
$("protocol-confirm").addEventListener("click", async () => {
  const action = pendingProtocolAction;
  pendingProtocolAction = "";
  markProtocolConfirmed();
  $("protocol-modal").classList.add("hidden");
  if (action) await submitAction(action);
});

async function submitAction(text) {
  if (!text.trim() || busy || session?.ended) return;
  stickToBottom = true;
  appendSegment({ type: "player", text });
  $("input").value = "";
  $("input").style.height = "";
  setBusy(true, "……");
  try {
    let data = await fetchJsonWithRetry(
      "/api/action",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          language: currentUiLanguage(),
          protocol: protocolState.enabled ? protocolRules() : [],
        }),
      },
      { retries: 0, timeout: 240000 }
    );
    if (data.__status >= 400 && data.needNewGame) {
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
          data = await fetchJsonWithRetry(
            "/api/action",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                text,
                language: currentUiLanguage(),
                protocol: protocolState.enabled ? protocolRules() : [],
              }),
            },
            { retries: 0, timeout: 240000 }
          );
        }
      }
    }
    setBusy(false);
    if (data.error) {
      appendSegment({ type: "sys", text: data.error });
      return;
    }
    const previousLog = Array.isArray(session?.log) ? session.log : [];
    const appendedLog = Array.isArray(data.appendedLog) ? data.appendedLog : (data.segments || []);
    session = { ...data.session, log: previousLog.concat(appendedLog) };
    try {
      localStorage.setItem("pt-autosave", JSON.stringify({ savedAt: Date.now(), session: { ...session, log: (session.log || []).slice(-200) } }));
    } catch {}
    renderSession();
    renderTurnView(-1, true);
  } catch (e) {
    setBusy(false);
    const message = String((e && e.message) || e || "");
    appendSegment({ type: "sys", text: /连不上服务器|没有响应/.test(message) ? message : "请求失败：" + message });
    // 这一回合没成功：把玩家刚才的行动放回输入框，避免白写
    if (!$("input").value.trim()) {
      $("input").value = text;
      $("input").style.height = "";
    }
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
  const previousLog = Array.isArray(session?.log) ? session.log : [];
  const appendedLog = Array.isArray(data.appendedLog) ? data.appendedLog : (data.segments || []);
  session = { ...data.session, log: previousLog.concat(appendedLog) };
  renderSession();
  renderTurnView(-1, true);
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
  setBottomNavActive("home");
  $("log").innerHTML = "";
  renderSession();
  (session.log || []).forEach((entry) => appendSegment(entry, true));
  stickToBottom = true;
  renderTurnView(-1, true);
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

/* ---------- 正文 TXT 导入 / 导出 ---------- */

function downloadPlainText(fileName, content) {
  const blob = new Blob([String(content || "")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function parseReplayText(raw) {
  const lines = String(raw || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const turns = [];
  let current = null;
  let mode = "body";
  const pushCurrent = () => {
    if (!current) return;
    const body = current.body.join("\n").trim();
    const action = current.action.join("\n").trim();
    if (body || action || current.options.length) turns.push({ ...current, body, action });
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line.match(/^第\s*(\d+)\s*回合\s*$/) || (/^开场\s*$/.test(line) ? [line, "0"] : null);
    if (heading) {
      pushCurrent();
      current = { n: Number(heading[1]) || (heading[1] === "0" ? 0 : turns.length + 1), body: [], options: [], action: [] };
      mode = "body";
      continue;
    }
    if (!current) continue;
    if (/^(?:推荐行动|推荐选项|可选行动|行动建议)\s*[：:]?\s*$/i.test(line)) {
      mode = "options";
      continue;
    }
    if (/^我的行动\s*[：:]?\s*(.*)$/i.test(line)) {
      mode = "action";
      const rest = line.replace(/^我的行动\s*[：:]?\s*/i, "").trim();
      if (rest) current.action.push(rest);
      continue;
    }
    if (mode === "options") {
      const option = line.match(/^(?:\d{1,2}\s*[.)、．]|[-*•])\s*(.+)$/);
      if (option) current.options.push(option[1].trim().slice(0, 300));
      else if (line && current.options.length && !/^<(?:state|checks)>/i.test(line)) {
        current.options[current.options.length - 1] += line;
      }
      continue;
    }
    if (mode === "action") {
      if (line) current.action.push(line);
      continue;
    }
    if (line) current.body.push(rawLine.trimEnd());
  }
  pushCurrent();
  return turns;
}

function replayTextFromSession(sess) {
  const out = [
    `【${sess.scenario?.title || "跑团"} · 游玩正文】`,
    `角色：${sess.character?.name || "未记录"}`,
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
  ];
  const groups = buildTurnGroups(sess);
  const totalTurns = Math.max(1, groups.filter((group) => group.turn > 0).length);
  for (const group of groups) {
    out.push(group.turn ? `第 ${group.turn} 回合` : "开场");
    const suggestions = [];
    for (const entry of group.entries) {
      if (entry.type === "player") continue;
      if (Array.isArray(entry.suggestions)) suggestions.push(...entry.suggestions);
      if (entry.type === "gm") out.push(String(entry.text || ""));
      else if (entry.type === "dice") out.push(`【判定】${entry.text || ""}`);
      else if (entry.type === "event") out.push(`【事件】${entry.text || ""}`);
      else if (entry.type === "change") out.push(`【状态变化】${entry.text || ""}`);
      else if (entry.type === "sys") out.push(`【系统】${entry.text || ""}`);
      out.push("");
    }
    if (suggestions.length) {
      out.push("推荐选项：");
      suggestions.slice(0, 4).forEach((option, index) => out.push(`${index + 1}. ${option}`));
      out.push("");
    }
    const player = [...group.entries].reverse().find((entry) => entry.type === "player");
    if (player) {
      out.push("我的行动：");
      out.push(String(player.text || ""));
      out.push("");
    }
  }
  out.push(`共 ${totalTurns} 回合`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

$("btn-export-txt").addEventListener("click", () => {
  if (!session) {
    alert("先开始一局游戏，再导出正文。");
    return;
  }
  const title = session.scenario?.title || "跑团";
  const name = session.character?.name || "角色";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  downloadPlainText(`${title}-${name}-正文-${stamp}.txt`, replayTextFromSession(session));
});

$("btn-import-replay").addEventListener("click", () => $("replay-file-input").click());
$("replay-file-input").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (!session) {
    alert("请先创建角色并开始一局，再导入正文。");
    return;
  }
  const turns = parseReplayText(await file.text());
  if (!turns.length) {
    alert("没有识别到“第 N 回合”结构。请选择参考程序导出的《正文.txt》。");
    return;
  }
  if (!confirm(`识别到 ${turns.length} 个回合。导入会替换当前剧情正文记录；完整属性、关系和历史记录仍以 JSON 存档为准。继续吗？`)) return;
  const log = [];
  for (const turn of turns) {
    if (turn.action) log.push({ type: "player", text: turn.action, turn: turn.n });
    if (turn.body || turn.options.length) {
      log.push({
        type: "gm",
        text: turn.body || "（该回合没有正文）",
        suggestions: turn.options.slice(0, 4),
        turn: turn.n,
      });
    }
  }
  const next = {
    ...session,
    log,
    turns: Math.max(...turns.map((turn) => turn.n)),
    opening: log.find((entry) => entry.type === "gm")?.text || session.opening,
    updatedAt: new Date().toISOString(),
  };
  try {
    const response = await fetch("/api/save/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: next }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "导入失败");
    try {
      localStorage.setItem("pt-autosave", JSON.stringify({ savedAt: Date.now(), session: data.session }));
    } catch {}
    showSession(data.session);
  } catch (error) {
    alert(`正文导入失败：${error.message || error}`);
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
    `<div class="op-meta">${escHtml(sc.genre || "")} · ${session.mode === "free" ? "自由探索" : diff + "难度 · 跑团规则"} · ${escHtml(compactClock(session.clock))}</div>` +
    (sc.blurb ? `<div class="op-meta">${escHtml(sc.blurb)}</div>` : "") +
    `<div class="op-sec">你的角色</div>` +
    `<div>${escHtml(c.name || "无名旅人")}${c.role ? " · " + escHtml(c.role) : ""}</div>` +
    `<div class="op-attrs">${attrs}</div>` +
    (session.mode === "free" && c.ability ? `<div class="op-meta">能力：${escHtml(c.ability)}</div>` : "") +
    `<div class="op-meta">随身：${(session.inventory || []).map(escHtml).join("、") || "空"}　生命 ${session.status?.hp}/${session.status?.hpMax}　${session.mode === "free" ? "精神" : "理智"} ${session.status?.san}/${session.status?.sanMax}</div>` +
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
let currentOnlineEstimate = 1;

function updateHud(data) {
  if (data.online != null) {
    currentOnlineEstimate = Math.max(1, Number(data.online) || 1);
    $("online-count").textContent = String(currentOnlineEstimate);
  }
  if (data.up != null) $("vote-up-count").textContent = String(data.up);
  if (data.down != null) $("vote-down-count").textContent = String(data.down);
  if (data.mine !== undefined) {
    $("vote-up").classList.toggle("on", data.mine === "up");
    $("vote-down").classList.toggle("on", data.mine === "down");
  }
}

let heartbeatBusy = false;
const heartbeatDisabled = new URLSearchParams(location.search).get("no-heartbeat") === "1";

async function beat() {
  if (heartbeatDisabled || heartbeatBusy || document.hidden) return;
  heartbeatBusy = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch("/api/presence", { method: "POST", signal: controller.signal });
    if (r.ok) updateHud(await r.json());
  } catch {
  } finally {
    clearTimeout(timer);
    heartbeatBusy = false;
  }
}

let heartbeatTimer = 0;

function queueHeartbeat(immediate = false) {
  clearTimeout(heartbeatTimer);
  const wait = currentOnlineEstimate >= 60 ? 4000 : currentOnlineEstimate >= 25 ? 2500 : 1000;
  heartbeatTimer = setTimeout(async () => {
    await beat();
    if (!document.hidden) queueHeartbeat();
  }, immediate ? 80 : wait);
}

document.addEventListener("visibilitychange", () => {
  if (heartbeatDisabled) return;
  if (document.hidden) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = 0;
    return;
  }
  queueHeartbeat(true);
});

async function castVote(value) {
  try {
    const r = await fetch("/api/vote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
    const data = await r.json();
    if (r.ok) updateHud(data);
    else alert(data.error || "投票失败");
  } catch {}
}

let fbPage = 1;
let fbPages = 1;
let fbSort = "time";
let feedbackRenderKey = "";

function fmtTime(value) {
  try {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function feedbackAvatar(name, avatar) {
  const wrap = document.createElement("span");
  wrap.className = "fb-author";
  if (avatar) {
    const img = document.createElement("img");
    img.className = "fb-avatar";
    img.src = avatar;
    img.alt = "";
    wrap.appendChild(img);
  } else {
    const ph = document.createElement("span");
    ph.className = "fb-avatar ph";
    ph.textContent = String(name || "匿").slice(0, 1);
    wrap.appendChild(ph);
  }
  const label = document.createElement("span");
  label.textContent = name || "匿名旅人";
  wrap.appendChild(label);
  return wrap;
}

function feedbackItem(m) {
  const item = document.createElement("div");
  item.className = "fb-item";

  const meta = document.createElement("div");
  meta.className = "fb-meta";
  const left = feedbackAvatar(m.name, m.avatar);
  const right = document.createElement("span");
  right.textContent = fmtTime(m.at) + (m.editedAt ? " · 已编辑" : "");
  meta.append(left, right);

  const text = document.createElement("div");
  text.className = "fb-text";
  text.textContent = m.text;
  item.append(meta, text);

  const reactions = document.createElement("div");
  reactions.className = "social-actions";
  const like = document.createElement("button");
  like.type = "button";
  like.className = "social-action" + (m.liked ? " on" : "");
  like.textContent = `♥ ${Number(m.likes) || 0}`;
  like.addEventListener("click", async () => {
    const r = await fetch("/api/feedback/like", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: m.id }),
    });
    if (r.ok) loadFeedback();
  });
  const replyButton = document.createElement("button");
  replyButton.type = "button";
  replyButton.className = "social-action";
  replyButton.textContent = "回复";
  reactions.append(like, replyButton);
  item.appendChild(reactions);

  const replies = document.createElement("div");
  replies.className = "feedback-replies";
  const replyForm = document.createElement("div");
  replyForm.className = "inline-reply hidden";
  const replyInput = document.createElement("input");
  replyInput.maxLength = 300;
  replyInput.placeholder = "回复这条留言…";
  const replySend = document.createElement("button");
  replySend.type = "button";
  replySend.textContent = "发送";
  let replyToId = "";
  const openReply = (replyId = "", replyName = "") => {
    replyToId = replyId;
    replyInput.placeholder = replyName ? `回复 ${replyName}…` : "回复这条留言…";
    replyForm.classList.remove("hidden");
    replyInput.focus();
  };
  replyButton.addEventListener("click", () => openReply());
  for (const reply of m.replies || []) {
    const row = document.createElement("div");
    row.className = "feedback-reply";
    const head = document.createElement("div");
    head.className = "fb-meta";
    head.appendChild(feedbackAvatar(reply.name, reply.avatar));
    const time = document.createElement("span");
    time.textContent = fmtTime(reply.at);
    head.appendChild(time);
    const body = document.createElement("div");
    body.className = "feedback-reply-text";
    if (reply.replyToName) {
      const to = document.createElement("span");
      to.className = "reply-to";
      to.textContent = `回复 @${reply.replyToName}：`;
      body.appendChild(to);
    }
    body.appendChild(document.createTextNode(reply.text || ""));
    const actions = document.createElement("div");
    actions.className = "social-actions compact";
    const replyLike = document.createElement("button");
    replyLike.type = "button";
    replyLike.className = "social-action" + (reply.liked ? " on" : "");
    replyLike.textContent = `♥ ${Number(reply.likes) || 0}`;
    replyLike.addEventListener("click", async () => {
      const r = await fetch("/api/feedback/reply/like", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: m.id, replyId: reply.id }),
      });
      if (r.ok) loadFeedback();
    });
    const replyAgain = document.createElement("button");
    replyAgain.type = "button";
    replyAgain.className = "social-action";
    replyAgain.textContent = "回复";
    replyAgain.addEventListener("click", () => openReply(reply.id, reply.name));
    actions.append(replyLike, replyAgain);
    row.append(head, body, actions);
    replies.appendChild(row);
  }
  replySend.addEventListener("click", async () => {
    const value = replyInput.value.trim();
    if (!value) return;
    replySend.disabled = true;
    const r = await fetch("/api/feedback/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: m.id, replyToId, text: value }),
    });
    replySend.disabled = false;
    if (r.ok) loadFeedback();
    else {
      const data = await r.json();
      alert(data.error || "回复失败");
    }
  });
  replyForm.append(replyInput, replySend);
  if ((m.replies || []).length) item.appendChild(replies);
  item.appendChild(replyForm);

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
    const r = await fetch(`/api/feedback?page=${fbPage}&size=8&sort=${encodeURIComponent(fbSort)}`);
    if (!r.ok) return;
    const data = await r.json();
    updateHud(data);
    fbPages = data.pages || 1;
    fbPage = data.page || 1;
    $("fb-count").textContent = String(data.total || 0);
    $("fb-page").textContent = `第 ${fbPage} / ${fbPages} 页`;
    $("fb-prev").disabled = fbPage <= 1;
    $("fb-next").disabled = fbPage >= fbPages;

    const nextRenderKey = JSON.stringify([
      fbPage,
      fbPages,
      fbSort,
      data.total || 0,
      data.up || 0,
      data.down || 0,
      data.messages || [],
    ]);
    if (nextRenderKey === feedbackRenderKey) return;
    feedbackRenderKey = nextRenderKey;

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

function setNoticeView(view) {
  const next = view === "feedback" ? "feedback" : "announcements";
  $("notice-announcements-view")?.classList.toggle("hidden", next !== "announcements");
  $("notice-feedback-view")?.classList.toggle("hidden", next !== "feedback");
  document.querySelectorAll("[data-notice-view]").forEach((button) => {
    button.classList.toggle("on", button.dataset.noticeView === next);
  });
}

function openFeedback(view = "feedback") {
  $("fb-modal").classList.remove("hidden");
  setNoticeView(view);
  loadFeedback();
  clearInterval(fbTimer);
  fbTimer = setInterval(() => {
    if (
      !document.hidden &&
      !$("fb-modal").classList.contains("hidden") &&
      !$("notice-feedback-view").classList.contains("hidden") &&
      !$("fb-list").contains(document.activeElement)
    ) loadFeedback();
  }, 6000);
}

function closeFeedback() {
  $("fb-modal").classList.add("hidden");
  clearInterval(fbTimer);
  fbTimer = null;
  setBottomNavActive("home");
}

$("vote-up").addEventListener("click", () => castVote("up"));
$("vote-down").addEventListener("click", () => castVote("down"));
$("feedback-open").addEventListener("click", () => {
  openFeedback("feedback");
  setBottomNavActive("notice");
});
$("notice-view-tabs")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-notice-view]");
  if (button) setNoticeView(button.dataset.noticeView);
});
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

$("fb-sort").addEventListener("click", (event) => {
  const button = event.target.closest("[data-fb-sort]");
  if (!button) return;
  fbSort = button.dataset.fbSort === "hot" ? "hot" : "time";
  $("fb-sort").querySelectorAll("button").forEach((item) => item.classList.toggle("on", item === button));
  fbPage = 1;
  loadFeedback();
});

/* ---------- 网站主题 ---------- */

const DEFAULT_SITE_THEME = "cream";
const SITE_THEMES = new Set(["pink", "cream", "ink-green", "warm-brown", "night-blue", "violet-night", "pure-black"]);

function applySiteTheme(value) {
  if (SITE_THEMES.has(value)) document.documentElement.dataset.theme = value;
  else document.documentElement.dataset.theme = DEFAULT_SITE_THEME;
}

function markThemeButtons() {
  const current = me?.siteTheme || DEFAULT_SITE_THEME;
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

if (!heartbeatDisabled) queueHeartbeat(true);
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
    siteTheme: me?.siteTheme || DEFAULT_SITE_THEME,
  };
  const r = await fetch("/api/me", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (r.ok) {
    me = data;
    loadAccountState();
    $("me-status").textContent = "已保存";
    setTimeout(() => ($("me-status").textContent = ""), 2000);
  } else {
    $("me-status").textContent = data.error || "保存失败";
  }
}

let accountInfo = null;
let accountAuthMode = "login";
let accountSocialPeer = null;
let accountVerificationChallenges = { login: "", register: "", recover: "", bind: "" };
let accountRecoveryRevealAttemptedFor = "";

function accountTime(value) {
  if (!value) return "未知时间";
  try {
    return new Date(value).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "未知时间";
  }
}

function updateAccountSummary() {
  const loggedIn = Boolean(accountInfo?.loggedIn);
  if (!loggedIn && accountInfo?.ownerMode) {
    $("account-state").textContent = "当前为房主模式";
    $("account-state-hint").textContent = "房主身份由后台密码和设备会话保护，无需创建玩家账号。";
    $("account-open").classList.add("hidden");
    return;
  }
  $("account-open").classList.remove("hidden");
  $("account-state").textContent = loggedIn
    ? `已登录：${accountInfo.account.name}`
    : "当前为匿名浏览器身份";
  $("account-state-hint").textContent = loggedIn
    ? `账号已连接 ${accountInfo.account.devices.length} 台设备；资料和存档会同步。`
    : "注册后可跨设备同步资料、剧本和存档；匿名试玩仍可使用。";
  $("account-open").textContent = loggedIn ? "管理账号" : "注册 / 登录";
}

async function loadAccountState() {
  try {
    const response = await fetch("/api/account", { cache: "no-store" });
    if (!response.ok) return;
    accountInfo = await response.json();
    updateAccountSummary();
    renderAccountPanel();
  } catch {}
}

function setAccountAuthMode(mode) {
  accountAuthMode = ["login", "register", "recover"].includes(mode) ? mode : "login";
  document.querySelectorAll("[data-account-mode]").forEach((button) => {
    button.classList.toggle("on", button.dataset.accountMode === accountAuthMode);
  });
  $("account-confirm-wrap").classList.toggle("hidden", accountAuthMode === "login");
  $("account-recovery-wrap").classList.toggle("hidden", accountAuthMode !== "recover");
  $("account-identifier-wrap").classList.toggle("hidden", false);
  $("account-code-wrap").classList.toggle("hidden", false);
  $("account-submit").textContent =
    accountAuthMode === "register" ? "注册账号" : accountAuthMode === "recover" ? "重置密码并登录" : "登录";
  $("account-auth-status").textContent = "";
  $("account-code-status").textContent = "";
  accountVerificationChallenges[accountAuthMode] = "";
  $("account-auth-password").autocomplete =
    accountAuthMode === "login" ? "current-password" : "new-password";
}

function updateAccountProviders() {
  const providers = accountInfo?.authProviders || {};
  document.querySelectorAll("[data-oauth-provider]").forEach((button) => {
    const provider = button.dataset.oauthProvider;
    const enabled = Boolean(providers[provider]?.enabled);
    button.disabled = !enabled;
    button.title = enabled ? `使用${providers[provider].label}登录或注册` : "网站管理员尚未配置该平台";
  });
  document.querySelectorAll("[data-bind-oauth]").forEach((button) => {
    const provider = button.dataset.bindOauth;
    const enabled = Boolean(providers[provider]?.enabled);
    button.disabled = !enabled;
    button.title = enabled ? `绑定${providers[provider].label}` : "网站管理员尚未配置该平台";
  });
  if (accountInfo && !accountInfo.loggedIn) {
    const unavailable = ["qq", "wechat"].filter((provider) => !providers[provider]?.enabled);
    $("account-oauth-status").textContent = unavailable.length
      ? "灰色按钮需要先在后台配置对应平台的 App ID 和密钥。"
      : "";
  }
}

function renderLinkedIdentities(account) {
  const box = $("account-linked-identities");
  box.innerHTML = "";
  const labels = { email: "邮箱", phone: "手机号", qq: "QQ", wechat: "微信" };
  let linked = 0;
  for (const type of ["email", "phone", "qq", "wechat"]) {
    const identity = account.identities?.[type];
    if (!identity?.linked) continue;
    linked += 1;
    const row = el("div", "account-device");
    const info = document.createElement("div");
    const title = el("b", "", labels[type]);
    const value = type === "email" || type === "phone"
      ? identity.masked
      : identity.nickname || "已授权";
    info.append(title, el("div", "meta", value));
    const unlink = el("button", "ghost", "解绑");
    unlink.type = "button";
    unlink.addEventListener("click", async () => {
      if (!confirm(`确定解绑${labels[type]}？解绑后不能再使用它登录。`)) return;
      const response = await fetch("/api/account/identities/unlink", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await response.json();
      if (!response.ok) return alert(data.error || "解绑失败");
      accountInfo.account = data.account;
      renderAccountPanel();
    });
    row.append(info, unlink);
    box.appendChild(row);
  }
  if (!linked) box.appendChild(el("div", "hint", "尚未绑定邮箱、手机号、QQ 或微信。"));
}

function renderAccountDevices(account) {
  const box = $("account-devices");
  box.innerHTML = "";
  for (const device of account.devices || []) {
    const row = el("div", "account-device");
    const info = document.createElement("div");
    const title = document.createElement("b");
    title.textContent = device.label || "浏览器设备";
    const meta = el(
      "div",
      "meta",
      `${device.current ? "当前设备 · " : ""}最近使用 ${accountTime(device.lastSeenAt)}`
    );
    info.append(title, meta);
    const revoke = el("button", "ghost", device.current ? "退出此设备" : "撤销");
    revoke.type = "button";
    revoke.addEventListener("click", async () => {
      if (!confirm(device.current ? "退出当前设备后需要重新登录。继续吗？" : "撤销这台设备的登录状态？")) return;
      const response = await fetch("/api/account/devices/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: device.id }),
      });
      const data = await response.json();
      if (!response.ok) return alert(data.error || "撤销失败");
      if (data.loggedIn === false) {
        alert("当前设备已退出账号。");
        await loadAccountState();
        await loadMe();
      } else {
        accountInfo.account = data.account;
        renderAccountPanel();
      }
    });
    row.append(info, revoke);
    box.appendChild(row);
  }
}

function renderAccountLogs(account) {
  const box = $("account-log-list");
  box.innerHTML = "";
  const labels = {
    register: "注册",
    login: "登录",
    logout: "退出",
    recovery: "账号找回",
    "recovery-login": "找回后登录",
    "password-change": "密码修改",
    "device-revoke": "设备撤销",
    "device-revoke-all": "其他设备撤销",
    "api-key-updated": "API Key 更新",
    "api-key-deleted": "API Key 删除",
    "nickname-change": "昵称修改",
    "data-export": "数据导出",
    "report-submit": "举报提交",
    "register-contact": "联系方式注册",
    "login-contact": "联系方式登录",
    "recovery-contact": "联系方式找回",
    "recovery-contact-login": "找回后登录",
    "recovery-code-reveal": "恢复码展示",
    "password-set": "设置密码",
    "identity-bind-email": "绑定邮箱",
    "identity-bind-phone": "绑定手机号",
    "identity-unlink-email": "解绑邮箱",
    "identity-unlink-phone": "解绑手机号",
    "identity-unlink-qq": "解绑 QQ",
    "identity-unlink-wechat": "解绑微信",
    "identity-bind-oauth": "绑定第三方账号",
    "oauth-login": "第三方授权登录",
  };
  for (const log of account.securityLog || []) {
    const row = el("div", "account-row");
    const text = document.createElement("div");
    const title = el("b", "", labels[log.type] || log.type || "安全事件");
    const summary = el("div", "meta", log.summary || "");
    const time = el("div", "meta", `${accountTime(log.at)}${log.ipHash ? ` · 来源指纹 ${log.ipHash.slice(0, 6)}…` : ""}`);
    text.append(title, summary, time);
    row.appendChild(text);
    box.appendChild(row);
  }
  if (!box.children.length) box.appendChild(el("div", "hint", "暂无安全日志。"));
}

function renderAccountPanel() {
  const loggedIn = Boolean(accountInfo?.loggedIn);
  $("account-anon").classList.toggle("hidden", loggedIn);
  $("account-logged").classList.toggle("hidden", !loggedIn);
  if (!loggedIn) {
    setAccountAuthMode(accountAuthMode);
    updateAccountSummary();
    updateAccountProviders();
    return;
  }
  const account = accountInfo.account;
  $("account-login-name").textContent = account.name;
  $("account-created").textContent =
    `注册于 ${accountTime(account.createdAt)} · 账号标识 ${account.accountIdMasked}` +
    ` · 今日默认模型 ${account.freeCallsUsed || 0}/${account.dailyFreeCalls || "不限"}` +
    ` · ${account.passwordEnabled ? "已设置密码" : "当前使用第三方授权登录"}`;
  document.querySelector(".account-avatar").textContent = (account.name || "A").slice(0, 1);
  $("account-current-password-wrap").classList.toggle("hidden", !account.passwordEnabled);
  $("account-password-open").textContent = account.passwordEnabled ? "修改密码" : "设置密码";
  renderLinkedIdentities(account);
  renderAccountDevices(account);
  renderAccountLogs(account);
  updateAccountProviders();
  updateAccountSummary();
  if (account.recoveryPending && accountRecoveryRevealAttemptedFor !== account.accountIdMasked) {
    accountRecoveryRevealAttemptedFor = account.accountIdMasked;
    fetch("/api/account/recovery/reveal", { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => {
        if (!ok) return;
        prompt(data.warning || "请离线保存一次性恢复码", data.recoveryCode);
        if (accountInfo?.account) accountInfo.account.recoveryPending = false;
      })
      .catch(() => {
        accountRecoveryRevealAttemptedFor = "";
      });
  }
}

async function submitAccountAuth() {
  const type = $("account-auth-identifier-type").value;
  const identifier = $("account-auth-identifier").value.trim();
  const code = $("account-auth-code").value.trim();
  const challengeId = accountVerificationChallenges[accountAuthMode];
  let endpoint = `/api/account/${accountAuthMode}`;
  const payload = {
    name: $("account-auth-name").value,
    password: $("account-auth-password").value,
    confirmPassword: $("account-auth-confirm").value,
  };
  if (identifier) Object.assign(payload, { type, value: identifier });
  if (code) Object.assign(payload, { code, challengeId });
  if (accountAuthMode === "recover") {
    payload.recoveryCode = $("account-auth-recovery").value;
    if (identifier && code) endpoint = "/api/account/recover/contact";
  } else if (accountAuthMode === "register" && identifier && code) {
    endpoint = "/api/account/register/contact";
  } else if (accountAuthMode === "login" && identifier) {
    endpoint = "/api/account/login/contact";
  }
  if (identifier && !code && accountAuthMode !== "login") {
    $("account-auth-status").textContent = "请先获取并填写验证码。";
    return;
  }
  if (accountAuthMode === "login" && identifier && !code && !payload.password) {
    $("account-auth-status").textContent = "请输入密码，或先获取并填写验证码。";
    return;
  }
  $("account-submit").disabled = true;
  $("account-auth-status").textContent =
    accountAuthMode === "register" ? "正在创建账号…" : accountAuthMode === "recover" ? "正在验证恢复码…" : "正在登录…";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      $("account-auth-status").textContent = data.error || "操作失败";
      return;
    }
    $("account-auth-status").textContent = "成功";
    if (data.recoveryCode) {
      prompt(`${data.warning || "请保存恢复码"}`, data.recoveryCode);
    }
    $("account-auth-name").value = "";
    $("account-auth-password").value = "";
    $("account-auth-confirm").value = "";
    $("account-auth-recovery").value = "";
    $("account-auth-identifier").value = "";
    $("account-auth-code").value = "";
    accountVerificationChallenges[accountAuthMode] = "";
    await loadMe();
    await loadAccountState();
  } catch (error) {
    $("account-auth-status").textContent = "网络错误：" + (error.message || error);
  } finally {
    $("account-submit").disabled = false;
  }
}

async function sendAccountVerificationCode(scope = accountAuthMode) {
  const isBind = scope === "bind";
  const type = isBind ? $("account-bind-type").value : $("account-auth-identifier-type").value;
  const value = (isBind ? $("account-bind-value").value : $("account-auth-identifier").value).trim();
  const button = isBind ? $("account-bind-send") : $("account-code-send");
  const status = isBind ? $("account-bind-status") : $("account-code-status");
  if (!value) {
    status.textContent = type === "email" ? "请先填写邮箱。" : "请先填写带国家区号的手机号。";
    return;
  }
  button.disabled = true;
  status.textContent = "正在发送…";
  try {
    const response = await fetch("/api/account/verification/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, value, purpose: isBind ? "bind" : scope }),
    });
    const data = await response.json();
    if (!response.ok) {
      status.textContent = data.error || "发送失败";
      return;
    }
    if (isBind) {
      $("account-bind-send").dataset.challengeId = data.challengeId;
    } else {
      accountVerificationChallenges[scope] = data.challengeId;
    }
    if (data.debugCode) {
      if (isBind) $("account-bind-code").value = data.debugCode;
      else $("account-auth-code").value = data.debugCode;
    }
    status.textContent = `验证码已发送至 ${data.masked}，10 分钟内有效。`;
  } catch (error) {
    status.textContent = "网络错误：" + (error.message || error);
  } finally {
    button.disabled = false;
  }
}

async function bindAccountIdentity() {
  const type = $("account-bind-type").value;
  const value = $("account-bind-value").value.trim();
  const code = $("account-bind-code").value.trim();
  const challengeId = $("account-bind-send").dataset.challengeId || "";
  if (!value || !code || !challengeId) {
    $("account-bind-status").textContent = "请先获取并填写验证码。";
    return;
  }
  $("account-bind-save").disabled = true;
  $("account-bind-status").textContent = "正在绑定…";
  try {
    const response = await fetch("/api/account/identities/bind", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, value, code, challengeId }),
    });
    const data = await response.json();
    if (!response.ok) {
      $("account-bind-status").textContent = data.error || "绑定失败";
      return;
    }
    $("account-bind-status").textContent = "绑定成功。";
    $("account-bind-value").value = "";
    $("account-bind-code").value = "";
    delete $("account-bind-send").dataset.challengeId;
    accountInfo.account = data.account;
    renderAccountPanel();
  } finally {
    $("account-bind-save").disabled = false;
  }
}

function syncContactInput(select, input) {
  const phone = select.value === "phone";
  input.type = phone ? "tel" : "email";
  input.autocomplete = phone ? "tel" : "email";
  input.placeholder = phone
    ? "例如 13812345678 或 +8613812345678"
    : "name@example.com";
}

$("account-open").addEventListener("click", () => {
  $("account-modal").classList.remove("hidden");
  loadAccountState();
});

document.querySelectorAll("[data-account-mode]").forEach((button) => {
  button.addEventListener("click", () => setAccountAuthMode(button.dataset.accountMode));
});
$("account-submit").addEventListener("click", submitAccountAuth);
$("account-code-send").addEventListener("click", () => sendAccountVerificationCode(accountAuthMode));
$("account-bind-send").addEventListener("click", () => sendAccountVerificationCode("bind"));
$("account-bind-save").addEventListener("click", bindAccountIdentity);
$("account-auth-identifier-type").addEventListener("change", () =>
  syncContactInput($("account-auth-identifier-type"), $("account-auth-identifier")));
$("account-bind-type").addEventListener("change", () =>
  syncContactInput($("account-bind-type"), $("account-bind-value")));

document.querySelectorAll("[data-oauth-provider]").forEach((button) => {
  button.addEventListener("click", () => {
    const provider = button.dataset.oauthProvider;
    if (button.disabled) return;
    location.href = `/api/account/oauth/${provider}/start?intent=${accountInfo?.loggedIn ? "bind" : "login"}`;
  });
});

document.querySelectorAll("[data-bind-oauth]").forEach((button) => {
  button.addEventListener("click", () => {
    const provider = button.dataset.bindOauth;
    if (button.disabled) return;
    location.href = `/api/account/oauth/${provider}/start?intent=bind`;
  });
});

$("account-logout").addEventListener("click", async () => {
  if (!confirm("退出当前设备的账号登录？账号资料仍会保留。")) return;
  await fetch("/api/account/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  await loadAccountState();
  await loadMe();
});

$("account-password-open").addEventListener("click", () => {
  $("account-password-box").classList.toggle("hidden");
});

$("account-password-save").addEventListener("click", async () => {
  const response = await fetch("/api/account/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      currentPassword: $("account-current-password").value,
      password: $("account-new-password").value,
      confirmPassword: $("account-new-password-confirm").value,
    }),
  });
  const data = await response.json();
  $("account-security-status").textContent = response.ok ? "密码已更新，其他设备已退出。" : data.error || "修改失败";
  if (response.ok) {
    $("account-current-password").value = "";
    $("account-new-password").value = "";
    $("account-new-password-confirm").value = "";
    accountInfo.account = data.account;
    renderAccountPanel();
  }
});

$("account-revoke-others").addEventListener("click", async () => {
  if (!confirm("退出当前账号在所有其他设备上的登录？")) return;
  const response = await fetch("/api/account/devices/revoke-others", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "操作失败");
  accountInfo.account = data.account;
  renderAccountPanel();
});

$("account-delete").addEventListener("click", async () => {
  const confirmText = $("account-delete-confirm").value;
  if (confirmText !== "删除我的数据") return alert("请完整输入“删除我的数据”。");
  if (!confirm("这会永久注销账号并删除全部资料、剧本、存档、社交关系和私信，确定继续吗？")) return;
  const response = await fetch("/api/privacy/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      confirm: confirmText,
      currentPassword: $("account-delete-password").value,
      recoveryCode: $("account-delete-recovery").value,
    }),
  });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "注销失败");
  alert("账号和个人数据已注销。");
  $("account-modal").classList.add("hidden");
  await loadAccountState();
  await loadMe();
  location.reload();
});

function accountSocialRow(card, buttons = []) {
  const row = el("div", "account-social-item");
  const info = document.createElement("div");
  const name = el("b", "", card.name || "匿名旅人");
  const meta = el("div", "meta", card.bio || `玩家 ID ${card.pid}`);
  info.append(name, meta);
  row.appendChild(info);
  for (const item of buttons) {
    const button = el("button", "ghost", item.label);
    button.type = "button";
    button.addEventListener("click", item.action);
    row.appendChild(button);
  }
  return row;
}

async function socialAction(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

async function loadAccountSocial() {
  const response = await fetch("/api/account/social", { cache: "no-store" });
  if (!response.ok) return;
  const data = await response.json();
  const requests = $("account-friend-requests");
  const friends = $("account-friends");
  const following = $("account-following");
  const blocked = $("account-blocked");
  requests.innerHTML = "";
  friends.innerHTML = "";
  following.innerHTML = "";
  blocked.innerHTML = "";
  for (const item of data.incoming || []) {
    requests.appendChild(
      accountSocialRow(item.from, [
        {
          label: "接受",
          action: async () => {
            await socialAction("/api/account/friend/respond", { requestId: item.id, accept: true });
            loadAccountSocial();
          },
        },
        {
          label: "拒绝",
          action: async () => {
            await socialAction("/api/account/friend/respond", { requestId: item.id, accept: false });
            loadAccountSocial();
          },
        },
      ])
    );
  }
  if (!requests.children.length) requests.appendChild(el("div", "hint", "没有待处理的好友请求。"));
  for (const card of data.friends || []) {
    friends.appendChild(
      accountSocialRow(card, [
        { label: "私信", action: () => openAccountMessages(card) },
        {
          label: "解除",
          action: async () => {
            if (!confirm(`解除与 ${card.name} 的好友关系？`)) return;
            await socialAction("/api/account/friend/remove", { pid: card.pid });
            loadAccountSocial();
          },
        },
      ])
    );
  }
  if (!friends.children.length) friends.appendChild(el("div", "hint", "还没有好友。"));
  for (const card of data.following || []) {
    following.appendChild(
      accountSocialRow(card, [
        {
          label: "取消关注",
          action: async () => {
            await socialAction("/api/account/follow", { pid: card.pid, action: "unfollow" });
            loadAccountSocial();
          },
        },
      ])
    );
  }
  if (!following.children.length) following.appendChild(el("div", "hint", "还没有关注其他玩家。"));
  for (const card of data.blocked || []) {
    blocked.appendChild(
      accountSocialRow(card, [
        {
          label: "解除拉黑",
          action: async () => {
            await socialAction("/api/account/block", { pid: card.pid, blocked: false });
            loadAccountSocial();
          },
        },
      ])
    );
  }
  if (!blocked.children.length) blocked.appendChild(el("div", "hint", "没有拉黑任何玩家。"));
  await loadAccountConversations();
}

async function loadAccountConversations() {
  const response = await fetch("/api/account/messages/conversations", { cache: "no-store" });
  if (!response.ok) return;
  const data = await response.json();
  const box = $("account-conversations");
  box.innerHTML = "";
  for (const item of data.conversations || []) {
    box.appendChild(
      accountSocialRow(
        { ...item, bio: item.lastText || "" },
        [{ label: item.unread ? `私信（${item.unread}）` : "打开私信", action: () => openAccountMessages(item) }]
      )
    );
  }
  if (!box.children.length) box.appendChild(el("div", "hint", "还没有好友私信。"));
}

async function openAccountMessages(peer) {
  accountSocialPeer = peer;
  $("account-message-view").classList.remove("hidden");
  $("account-message-title").textContent = `与 ${peer.name} 的私信`;
  const response = await fetch(`/api/account/messages?pid=${encodeURIComponent(peer.pid)}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "读取私信失败");
  const list = $("account-message-list");
  list.innerHTML = "";
  for (const message of data.messages || []) {
    const item = el("div", `account-message${message.mine ? " mine" : ""}`);
    item.appendChild(document.createTextNode(message.text));
    item.appendChild(el("span", "meta", accountTime(message.at)));
    list.appendChild(item);
  }
  if (!list.children.length) list.appendChild(el("div", "hint", "还没有消息，打个招呼吧。"));
  list.scrollTop = list.scrollHeight;
}

$("account-social-open").addEventListener("click", async () => {
  $("account-social-modal").classList.remove("hidden");
  $("account-message-view").classList.add("hidden");
  await loadAccountSocial();
});

$("account-message-send").addEventListener("click", async () => {
  const input = $("account-message-input");
  const text = input.value.trim();
  if (!text || !accountSocialPeer) return;
  const response = await fetch("/api/account/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pid: accountSocialPeer.pid, text }),
  });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "发送失败");
  input.value = "";
  await openAccountMessages(accountSocialPeer);
  await loadAccountConversations();
});

$("me-open").addEventListener("click", () => {
  $("me-modal").classList.remove("hidden");
  setBottomNavActive("profile");
  loadMe();
  loadAccountState();
  loadModelInfo();
});

function fillPrivacyForm(profile) {
  $("privacy-discoverable").checked = profile?.discoverable !== false;
  $("privacy-show-profile").checked = profile?.showProfile !== false;
  $("privacy-show-activity").checked = profile?.showActivity !== false;
  $("privacy-show-online").checked = profile?.showOnline !== false;
  $("privacy-default-visibility").value = SCENARIO_VISIBILITIES_FOR_UI.includes(profile?.creatorDefaultVisibility)
    ? profile.creatorDefaultVisibility
    : "public";
  $("privacy-accepted").checked = Number(profile?.privacyAcceptedAt) > 0;
  $("privacy-status").textContent = profile?.privacyVersion
    ? `协议版本 ${profile.privacyVersion} 已记录同意`
    : "保存前请阅读协议并勾选同意。";
}

async function openPrivacyCenter() {
  if (!me) await loadMe();
  fillPrivacyForm(me);
  $("privacy-modal").classList.remove("hidden");
}

$("me-privacy").addEventListener("click", openPrivacyCenter);

$("privacy-save").addEventListener("click", async () => {
  $("privacy-status").textContent = "保存中…";
  const payload = {
    discoverable: $("privacy-discoverable").checked,
    showProfile: $("privacy-show-profile").checked,
    showActivity: $("privacy-show-activity").checked,
    showOnline: $("privacy-show-online").checked,
    creatorDefaultVisibility: $("privacy-default-visibility").value,
    privacyAccepted: $("privacy-accepted").checked,
  };
  const r = await fetch("/api/me", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) {
    $("privacy-status").textContent = data.error || "保存失败";
    return;
  }
  me = { ...(me || {}), ...data };
  $("privacy-status").textContent = $("privacy-accepted").checked
    ? "隐私设置已保存，同意记录已更新。"
    : "隐私设置已保存；未记录协议同意。";
});

$("privacy-export").addEventListener("click", async () => {
  const button = $("privacy-export");
  button.disabled = true;
  $("privacy-status").textContent = "正在整理个人数据…";
  try {
    const r = await fetch("/api/privacy/export");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `paotuan-privacy-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    $("privacy-status").textContent = "个人数据已导出到本机。";
  } catch (error) {
    $("privacy-status").textContent = `导出失败：${error.message || error}`;
  } finally {
    button.disabled = false;
  }
});

$("privacy-delete").addEventListener("click", async () => {
  const typed = prompt("此操作不可撤销。请输入“删除我的数据”以继续：");
  if (typed !== "删除我的数据") return;
  const needsPassword = Boolean(accountInfo?.loggedIn && accountInfo.account?.passwordEnabled);
  const currentPassword = needsPassword
    ? prompt("这是已注册账号，请输入当前密码以确认注销：")
    : "";
  const recoveryCode = accountInfo?.loggedIn && !needsPassword
    ? prompt("该账号使用第三方登录且尚未设置密码，请输入一次性恢复码以确认注销：")
    : "";
  if (accountInfo?.loggedIn && !(needsPassword ? currentPassword : recoveryCode)) return;
  if (!confirm("最后确认：删除当前匿名身份下的资料、剧本、预设、存档和公开互动？")) return;
  $("privacy-status").textContent = "正在删除…";
  const r = await fetch("/api/privacy/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: typed, currentPassword, recoveryCode }),
  });
  const data = await r.json();
  if (!r.ok) {
    $("privacy-status").textContent = data.error || "删除失败";
    return;
  }
  alert(`${data.accountDeleted ? "账号注销" : "删除"}完成。剧本 ${data.removed?.scenarios || 0} 个、帖子 ${data.removed?.posts || 0} 条、留言 ${data.removed?.feedback || 0} 条。`);
  location.reload();
});

const GM_SLIDER_IDS = [
  "gm-violence",
  "gm-horror",
  "gm-romance",
  "gm-humor",
  "gm-lethality",
  "gm-worldFidelity",
  "gm-freedom",
  "gm-npcAutonomy",
];
let gmConsoleData = null;

function updateGmOutputs() {
  for (const id of GM_SLIDER_IDS) {
    const input = $(id);
    const out = document.querySelector(`[data-gm-output="${id}"]`);
    if (input && out) out.textContent = input.value;
  }
  if ($("gm-custom-count")) {
    $("gm-custom-count").textContent = `${$("gm-custom").value.length} / 6000`;
  }
}

function fillGmConsole(profile, baseRules) {
  gmConsoleData = { ...gmConsoleData, profile, baseRules };
  $("gm-enabled").checked = profile.enabled !== false;
  $("gm-custom").value = profile.customInstructions || "";
  for (const id of GM_SLIDER_IDS) {
    const key = id.slice(3);
    $(id).value = Number(profile[key] ?? 50);
  }
  if (baseRules != null) $("gm-base-rules").textContent = baseRules;
  updateGmOutputs();
}

async function loadGmConsole() {
  $("gm-status").textContent = "正在加载…";
  try {
    const response = await fetch("/api/gm-console", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    gmConsoleData = data;
    fillGmConsole(data.profile, data.baseRules);
    $("gm-status").textContent = "";
  } catch (error) {
    $("gm-status").textContent = `加载失败：${error.message || error}`;
  }
}

function gmProfileFromForm() {
  const profile = {
    enabled: $("gm-enabled").checked,
    customInstructions: $("gm-custom").value,
  };
  for (const id of GM_SLIDER_IDS) profile[id.slice(3)] = Number($(id).value);
  return profile;
}

$("gm-console-open").addEventListener("click", () => {
  $("gm-console-modal").classList.remove("hidden");
  if (!gmConsoleData) loadGmConsole();
});
for (const id of GM_SLIDER_IDS) $(id).addEventListener("input", updateGmOutputs);
$("gm-custom").addEventListener("input", updateGmOutputs);

document.querySelectorAll("[data-gm-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    const presets = {
      balanced: { violence: 45, horror: 45, romance: 35, humor: 30, lethality: 45, worldFidelity: 80, freedom: 75, npcAutonomy: 75 },
      immersive: { violence: 55, horror: 65, romance: 65, humor: 25, lethality: 50, worldFidelity: 85, freedom: 75, npcAutonomy: 85 },
      hardcore: { violence: 75, horror: 75, romance: 45, humor: 15, lethality: 80, worldFidelity: 85, freedom: 70, npcAutonomy: 80 },
      free: { violence: 50, horror: 45, romance: 45, humor: 35, lethality: 35, worldFidelity: 65, freedom: 92, npcAutonomy: 90 },
      light: { violence: 20, horror: 15, romance: 35, humor: 70, lethality: 20, worldFidelity: 75, freedom: 85, npcAutonomy: 70 },
    };
    const values = presets[button.dataset.gmPreset] || presets.balanced;
    for (const [key, value] of Object.entries(values)) $(`gm-${key}`).value = value;
    updateGmOutputs();
    $("gm-status").textContent = "已套用方案，保存后生效。";
  });
});

$("gm-save").addEventListener("click", async () => {
  $("gm-status").textContent = "正在保存…";
  try {
    const response = await fetch("/api/gm-console", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(gmProfileFromForm()),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    fillGmConsole(data, gmConsoleData?.baseRules);
    $("gm-status").textContent = "已保存，下一回合生效。";
    setTimeout(() => ($("gm-status").textContent = ""), 3000);
  } catch (error) {
    $("gm-status").textContent = `保存失败：${error.message || error}`;
  }
});

$("gm-reset").addEventListener("click", () => {
  const defaults = gmConsoleData?.defaults;
  if (!defaults) return;
  fillGmConsole(defaults, gmConsoleData?.baseRules);
  $("gm-status").textContent = "已恢复默认，保存后生效。";
});

const MODEL_CATALOG = [
  { id:"deepseek", name:"DeepSeek", color:"#4D6BFE", icon:"DS", baseUrl:"https://api.deepseek.com", models:["deepseek-v4-flash","deepseek-v4-pro","deepseek-chat","deepseek-reasoner"] },
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

function displayModelName(model, label) {
  const id = String(model || "").trim();
  if (label) return String(label);
  const known = {
    "deepseek-v4-flash": "DeepSeek-V4-Flash",
    "deepseek-v4-pro": "DeepSeek-V4-Pro",
    "deepseek-chat": "DeepSeek-Chat",
    "deepseek-reasoner": "DeepSeek-Reasoner",
  };
  return known[id.toLowerCase()] || id || "未配置";
}

function applyDefaultModelLabel(model, label) {
  const node = $("default-model-name");
  if (!node) return;
  node.textContent = displayModelName(model, label);
  node.title = model ? `模型标识：${model}` : "";
}

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
    applyDefaultModelLabel(m.defaultModel || meta?.model, m.defaultModelLabel || meta?.modelLabel);
    $("model-base").value = m.baseUrl || "";
    $("model-name").value = m.model || "";
    $("model-enabled").checked = !m.enabled;
    $("model-key").value = "";
    $("model-key").placeholder = m.keyMask ? `已保存：${m.keyMask}（留空不改）` : "sk-...";
    $("model-status").textContent = m.configured
      ? (m.enabled ? "已启用，你的对局会优先使用自己的模型" : "已保存，但未启用")
      : `未配置，将使用站点默认模型（${displayModelName(m.defaultModel || meta?.model, m.defaultModelLabel || meta?.modelLabel)}）`;
    const p = MODEL_CATALOG.find((x) => x.baseUrl && (m.baseUrl || "").startsWith(x.baseUrl));
    setModelIcon(p);
    if (p && p.models.includes(m.model)) $("model-picker").value = `${p.id}|${m.model}`;
  } catch {}
  updateModelBaseHint();
}

/* 本地地址提示：模型请求由服务器发出，云端站点访问不到玩家电脑上的地址 */
function isPrivateAddress(host) {
  const h = String(host || "").toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;
  return /^(127\.|10\.|192\.168\.|169\.254\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

function pageIsLocal() {
  const h = String(location.hostname || "").toLowerCase();
  return h === "localhost" || h === "::1" || /^(127\.|10\.|192\.168\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

function updateModelBaseHint() {
  const input = $("model-base");
  const box = $("model-base-hint");
  if (!input || !box) return;
  let host = "";
  try {
    host = new URL(String(input.value || "").trim()).hostname;
  } catch {}
  if (!host || !isPrivateAddress(host)) {
    box.textContent = "";
    return;
  }
  if (pageIsLocal()) {
    box.textContent = "本地/内网地址：只有在你本机运行站点时可用。";
  } else {
    box.textContent =
      "这是本地/内网地址。模型请求由网站服务器发出，线上站点访问不到你电脑上的地址——请在本机运行站点（127.0.0.1:8890），或给本地模型开公网隧道后填隧道地址。";
  }
}

$("model-base")?.addEventListener("input", updateModelBaseHint);
$("model-base")?.addEventListener("blur", updateModelBaseHint);

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
  $("model-status").textContent = r.ok ? `${d.reply || "配置格式有效"}（未消耗 API）` : d.error || "检查失败";
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
let cmGroups = [];
let cmCommentSort = "time";
const CM_SIDEBAR_SCALES = ["small", "normal", "wide"];
let cmSidebarScaleIndex = 1;

function applyCommunitySidebarScale() {
  const modal = $("cm-modal");
  if (!modal) return;
  const scale = CM_SIDEBAR_SCALES[cmSidebarScaleIndex] || "normal";
  modal.dataset.sidebarScale = scale;
  const label = { small: "紧凑", normal: "标准", wide: "宽" }[scale];
  if ($("cm-sidebar-scale-label")) $("cm-sidebar-scale-label").textContent = label;
  if ($("cm-sidebar-smaller")) $("cm-sidebar-smaller").disabled = cmSidebarScaleIndex <= 0;
  if ($("cm-sidebar-larger")) $("cm-sidebar-larger").disabled = cmSidebarScaleIndex >= CM_SIDEBAR_SCALES.length - 1;
  try {
    localStorage.setItem("pt-cm-sidebar-scale", scale);
  } catch {}
}

try {
  const savedScale = localStorage.getItem("pt-cm-sidebar-scale");
  const index = CM_SIDEBAR_SCALES.indexOf(savedScale);
  if (index >= 0) cmSidebarScaleIndex = index;
} catch {}
applyCommunitySidebarScale();

function renderCommunity(posts) {
  const list = $("cm-list");
  list.innerHTML = "";
  const filtered = posts.filter((p) => {
    if (cmFilter === "all") return true;
    if (cmFilter === "mine") return Boolean(p.pid && me && p.pid === me.pid);
    if (cmFilter === "原创" || cmFilter === "同人") return (p.origin || "原创") === cmFilter;
    if (cmFilter.startsWith("group:")) return p.communityId === cmFilter.slice("group:".length);
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
    const kinds = document.createElement("div");
    kinds.className = "cm-kinds";
    const origin = post.origin || "原创";
    for (const value of [origin, post.communityName, post.category].filter(Boolean)) {
      const tag = document.createElement("span");
      tag.className = "tag" + (value === origin ? " cm-origin" : "");
      tag.textContent = value;
      kinds.appendChild(tag);
    }
    if (kinds.children.length) card.appendChild(kinds);
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
      const actions = document.createElement("div");
      actions.className = "cm-scenario-actions";
      if (post.scenarioId) {
        const open = document.createElement("a");
        open.className = "cm-import";
        open.textContent = "打开剧本页面";
        open.href = `/scenario/${encodeURIComponent(post.scenarioId)}`;
        actions.appendChild(open);
      }
      actions.appendChild(imp);
      badge.append(head2, blurb, actions);
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
    const commentHead = document.createElement("div");
    commentHead.className = "cm-comments-head";
    commentHead.textContent = `评论 ${post.commentCount || (post.comments || []).length}`;
    comments.appendChild(commentHead);

    const orderedComments = [...(post.comments || [])].sort((a, b) => {
      if (cmCommentSort === "hot") {
        const hotA = (a.likes || 0) + (a.replies || []).length * 2 + (a.replies || []).reduce((sum, reply) => sum + (reply.likes || 0), 0);
        const hotB = (b.likes || 0) + (b.replies || []).length * 2 + (b.replies || []).reduce((sum, reply) => sum + (reply.likes || 0), 0);
        if (hotA !== hotB) return hotB - hotA;
      }
      return String(b.at || "").localeCompare(String(a.at || ""));
    });

    for (const c of orderedComments) {
      const thread = document.createElement("div");
      thread.className = "cm-comment-thread";
      const meta = document.createElement("div");
      meta.className = "cm-comment-meta";
      const who = document.createElement("b");
      who.textContent = c.author || "匿名旅人";
      const time = document.createElement("span");
      time.textContent = fmtTime(c.at);
      meta.append(who, time);
      const body = document.createElement("div");
      body.className = "cm-comment-body";
      body.textContent = c.text || "";
      const actions = document.createElement("div");
      actions.className = "social-actions compact";
      const cLike = document.createElement("button");
      cLike.type = "button";
      cLike.className = "social-action" + (c.liked ? " on" : "");
      cLike.textContent = `♥ ${Number(c.likes) || 0}`;
      cLike.addEventListener("click", async () => {
        const r = await fetch("/api/community/comment/like", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ postId: post.id, commentId: c.id }),
        });
        if (r.ok) loadCommunity();
      });
      actions.appendChild(cLike);

      const replyBox = document.createElement("div");
      replyBox.className = "inline-reply hidden";
      const replyInput = document.createElement("input");
      replyInput.maxLength = 300;
      const replySend = document.createElement("button");
      replySend.type = "button";
      replySend.textContent = "发送";
      let replyToId = "";
      const openReply = (replyId = "", replyName = "") => {
        replyToId = replyId;
        replyInput.placeholder = replyName ? `回复 ${replyName}…` : `回复 ${c.author || "匿名旅人"}…`;
        replyBox.classList.remove("hidden");
        replyInput.focus();
      };
      const cReply = document.createElement("button");
      cReply.type = "button";
      cReply.className = "social-action";
      cReply.textContent = "回复";
      cReply.addEventListener("click", () => openReply());
      actions.appendChild(cReply);

      const replyList = document.createElement("div");
      replyList.className = "cm-replies";
      const replies = [...(c.replies || [])].sort((a, b) => {
        if (cmCommentSort === "hot" && (a.likes || 0) !== (b.likes || 0)) return (b.likes || 0) - (a.likes || 0);
        return String(a.at || "").localeCompare(String(b.at || ""));
      });
      for (const reply of replies) {
        const replyRow = document.createElement("div");
        replyRow.className = "cm-reply";
        const replyMeta = document.createElement("div");
        replyMeta.className = "cm-comment-meta";
        const replyWho = document.createElement("b");
        replyWho.textContent = reply.author || "匿名旅人";
        const replyTime = document.createElement("span");
        replyTime.textContent = fmtTime(reply.at);
        replyMeta.append(replyWho, replyTime);
        const replyText = document.createElement("div");
        replyText.className = "cm-comment-body";
        if (reply.replyToName) {
          const to = document.createElement("span");
          to.className = "reply-to";
          to.textContent = `回复 @${reply.replyToName}：`;
          replyText.appendChild(to);
        }
        replyText.appendChild(document.createTextNode(reply.text || ""));
        const replyActions = document.createElement("div");
        replyActions.className = "social-actions compact";
        const replyLike = document.createElement("button");
        replyLike.type = "button";
        replyLike.className = "social-action" + (reply.liked ? " on" : "");
        replyLike.textContent = `♥ ${Number(reply.likes) || 0}`;
        replyLike.addEventListener("click", async () => {
          const r = await fetch("/api/community/comment/like", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ postId: post.id, commentId: c.id, replyId: reply.id }),
          });
          if (r.ok) loadCommunity();
        });
        const replyAgain = document.createElement("button");
        replyAgain.type = "button";
        replyAgain.className = "social-action";
        replyAgain.textContent = "回复";
        replyAgain.addEventListener("click", () => openReply(reply.id, reply.author));
        replyActions.append(replyLike, replyAgain);
        replyRow.append(replyMeta, replyText, replyActions);
        replyList.appendChild(replyRow);
      }
      replySend.addEventListener("click", async () => {
        const value = replyInput.value.trim();
        if (!value) return;
        replySend.disabled = true;
        const r = await fetch("/api/community/comment", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ postId: post.id, parentId: c.id, replyToId, text: value }),
        });
        replySend.disabled = false;
        if (r.ok) loadCommunity();
        else {
          const data = await r.json();
          alert(data.error || "回复失败");
        }
      });
      replyBox.append(replyInput, replySend);
      thread.append(meta, body, actions);
      if (replies.length) thread.appendChild(replyList);
      thread.appendChild(replyBox);
      comments.appendChild(thread);
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
    cmGroups = data.groups || [];
    renderCommunityGroups();
    renderCommunity(cmPosts);
  } catch {}
}

function renderCommunityGroups() {
  const box = $("cm-custom-groups");
  const picker = $("cm-group");
  if (!box) return;
  box.innerHTML = "";
  if (!cmGroups.length) {
    box.appendChild(el("span", "cm-group-empty", "还没有玩家社区"));
  }
  for (const group of cmGroups) {
    const button = el("button", "cm-group-link" + (cmFilter === `group:${group.id}` ? " on" : ""));
    button.type = "button";
    button.dataset.filter = `group:${group.id}`;
    button.title = group.description || group.name;
    button.appendChild(el("span", "", group.name));
    button.appendChild(el("small", "", `${group.postCount || 0} 帖`));
    button.addEventListener("click", () => {
      setCommunityFilter(`group:${group.id}`, button);
      if (picker) picker.value = group.id;
    });
    box.appendChild(button);
  }
  if (picker) {
    const current = picker.value;
    picker.innerHTML = '<option value="">不加入自定义社区</option>';
    for (const group of cmGroups) {
      const option = el("option", "", `${group.name}（${group.postCount || 0} 帖）`);
      option.value = group.id;
      picker.appendChild(option);
    }
    const activeGroupId = cmFilter.startsWith("group:") ? cmFilter.slice("group:".length) : "";
    const desired = current || activeGroupId;
    picker.value = cmGroups.some((group) => group.id === desired) ? desired : "";
  }
}

function setCommunityFilter(filter, activeButton = null) {
  cmFilter = filter;
  document.querySelectorAll("#cm-tabs button, #cm-custom-groups button").forEach((button) => {
    button.classList.toggle("on", activeButton ? button === activeButton : button.dataset.filter === filter);
  });
  const info = $("cm-group-info");
  if (info) {
    info.innerHTML = "";
    const group = filter.startsWith("group:")
      ? cmGroups.find((item) => item.id === filter.slice("group:".length))
      : null;
    info.classList.toggle("hidden", !group);
    if (group) {
      info.appendChild(el("b", "", group.name));
      info.appendChild(el("span", "", group.description || "这个社区还没有填写简介。"));
      info.appendChild(el("small", "", `${group.postCount || 0} 个帖子 · 创建者 ${group.ownerName || "匿名旅人"}`));
    }
  }
  renderCommunity(cmPosts);
}

$("cm-open").addEventListener("click", () => {
  $("cm-modal").classList.remove("hidden");
  setBottomNavActive("community");
  applyCommunitySidebarScale();
  loadCommunity();
});

$("cm-sidebar-smaller")?.addEventListener("click", () => {
  cmSidebarScaleIndex = Math.max(0, cmSidebarScaleIndex - 1);
  applyCommunitySidebarScale();
});

$("cm-sidebar-larger")?.addEventListener("click", () => {
  cmSidebarScaleIndex = Math.min(CM_SIDEBAR_SCALES.length - 1, cmSidebarScaleIndex + 1);
  applyCommunitySidebarScale();
});

document.querySelectorAll("#cm-tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    setCommunityFilter(b.dataset.filter, b);
    if ($("cm-group")) $("cm-group").value = "";
  });
});

$("cm-create-group")?.addEventListener("click", () => {
  $("cm-group-form")?.classList.remove("hidden");
  $("cm-group-name")?.focus();
});

$("cm-group-cancel")?.addEventListener("click", () => {
  $("cm-group-form")?.classList.add("hidden");
  $("cm-group-status").textContent = "";
});

$("cm-group-submit")?.addEventListener("click", async () => {
  const name = $("cm-group-name").value.trim();
  const description = $("cm-group-desc").value.trim();
  if (!name) {
    $("cm-group-status").textContent = "先填写社区名称。";
    return;
  }
  $("cm-group-status").textContent = "创建中…";
  const r = await fetch("/api/community/groups", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  const data = await r.json();
  if (!r.ok) {
    $("cm-group-status").textContent = data.error || "创建失败";
    return;
  }
  cmGroups = data.groups || [];
  renderCommunityGroups();
  cmFilter = `group:${data.group.id}`;
  $("cm-group").value = data.group.id;
  setCommunityFilter(cmFilter);
  $("cm-group-name").value = "";
  $("cm-group-desc").value = "";
  $("cm-group-status").textContent = "社区已创建，可以开始发帖。";
});

$("cm-comment-sort").addEventListener("click", (event) => {
  const button = event.target.closest("[data-comment-sort]");
  if (!button) return;
  cmCommentSort = button.dataset.commentSort === "hot" ? "hot" : "time";
  $("cm-comment-sort").querySelectorAll("button").forEach((item) => item.classList.toggle("on", item === button));
  renderCommunity(cmPosts);
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
    body: JSON.stringify({
      title,
      text,
      media,
      tags: $("cm-tags").value,
      category: $("cm-category").value,
      origin: $("cm-origin").value,
      communityId: $("cm-group").value,
    }),
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
  $("cm-origin").value = "原创";
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
        const open = document.createElement("a");
        open.className = "cm-import";
        open.textContent = "打开剧本";
        open.href = `/scenario/${encodeURIComponent(s.id)}`;
        open.target = "_blank";
        open.rel = "noopener";
        row.append(info, open);
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
    setBottomNavActive("home");
  });
});

/* 本机/内网打开时，分享出去的一律用公开地址；公网上打开就用自己的域名 */
function isLocalHostName(host) {
  const h = String(host || "").toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h === "::1" || h === "[::1]") return true;
  return /^(127\.|10\.|192\.168\.|169\.254\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

function shareOrigin() {
  const fallback = (meta && meta.publicBase) || "https://paotuan.onrender.com";
  return isLocalHostName(location.hostname) ? String(fallback).replace(/\/+$/, "") : location.origin;
}

try {
  const rk = (document.cookie.match(/(?:^|;\s*)rk=([^;]+)/) || [])[1];
  const rlink = document.querySelector('#hud a[href="/room"]') || document.querySelector('#hud a[href^="/room"]');
  if (rk && rlink) rlink.href = shareOrigin() + "/room?k=" + encodeURIComponent(rk);
} catch {}

(function initHudDrag() {
  const box = $("hud-left");
  const grip = document.querySelector(".hud-grip");
  const compact = $("hud-compact");
  const alpha = $("hud-alpha");
  const hide = $("hud-hide");
  const restore = $("hud-restore");
  if (!box || !grip) return;
  const KEY = "pt-hud-pos";
  const VIEW_KEY = "pt-hud-view";
  let view = { alpha: "solid", compact: false, hidden: false };
  let hasSavedView = false;
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "null");
    if (saved && typeof saved === "object") {
      hasSavedView = true;
      view.alpha = ["solid", "soft", "ghost"].includes(saved.alpha) ? saved.alpha : "solid";
      view.compact = Boolean(saved.compact);
      view.hidden = Boolean(saved.hidden);
    }
  } catch {}
  if (!hasSavedView && window.matchMedia("(max-width: 900px)").matches) {
    view.alpha = "soft";
    view.compact = true;
  }

  function placeRestoreAtBox() {
    if (!restore) return;
    restore.style.left = Math.max(4, box.offsetLeft) + "px";
    restore.style.top = Math.max(4, box.offsetTop) + "px";
  }

  function clampBoxPosition() {
    const width = box.offsetWidth || 120;
    const height = box.offsetHeight || 40;
    const left = Math.max(4, Math.min(window.innerWidth - width - 4, box.offsetLeft || 4));
    const top = Math.max(4, Math.min(window.innerHeight - height - 4, box.offsetTop || 4));
    box.style.left = left + "px";
    box.style.top = top + "px";
    if (restore) {
      restore.style.left = left + "px";
      restore.style.top = top + "px";
    }
  }

  function applyView() {
    box.classList.toggle("hud-soft", view.alpha === "soft");
    box.classList.toggle("hud-ghost", view.alpha === "ghost");
    box.classList.toggle("compact", view.compact);
    box.classList.toggle("hidden", view.hidden);
    restore?.classList.toggle("hidden", !view.hidden);
    compact?.setAttribute("aria-pressed", view.compact ? "true" : "false");
    alpha?.setAttribute("aria-pressed", view.alpha !== "solid" ? "true" : "false");
    if (restore) placeRestoreAtBox();
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {}
  }

  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) {
      box.style.left = p.left + "px";
      box.style.top = p.top + "px";
    }
  } catch {}
  clampBoxPosition();
  applyView();

  compact?.addEventListener("click", () => {
    view.compact = !view.compact;
    applyView();
  });
  alpha?.addEventListener("click", () => {
    const modes = ["solid", "soft", "ghost"];
    view.alpha = modes[(modes.indexOf(view.alpha) + 1) % modes.length];
    applyView();
  });
  hide?.addEventListener("click", () => {
    view.hidden = true;
    applyView();
  });
  restore?.addEventListener("click", () => {
    view.hidden = false;
    applyView();
  });

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
    if (restore) {
      restore.style.left = left + "px";
      restore.style.top = top + "px";
    }
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
  window.addEventListener("resize", () => {
    clampBoxPosition();
  });
})();

(function initMobileSidePanel() {
  const game = $("game");
  const toggle = $("btn-side-toggle");
  const close = $("side-close");
  const scrim = $("side-scrim");
  if (!game || !toggle || !close || !scrim) return;
  const setOpen = (open) => {
    game.classList.toggle("mobile-side-open", open);
    scrim.classList.toggle("hidden", !open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  };
  toggle.addEventListener("click", () => setOpen(!game.classList.contains("mobile-side-open")));
  close.addEventListener("click", () => setOpen(false));
  scrim.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) setOpen(false);
  });
})();

let activeSideTab = "player";
try {
  const saved = localStorage.getItem("pt-side-tab");
  if (["player", "chars", "archive", "protocol", "settings"].includes(saved)) activeSideTab = saved;
} catch {}

function applySideTab(tab) {
  activeSideTab = ["player", "chars", "archive", "protocol", "settings"].includes(tab) ? tab : "player";
  document.querySelectorAll("#side .sect[data-side-tab]").forEach((section) => {
    section.classList.toggle("side-tab-off", section.dataset.sideTab !== activeSideTab);
  });
  document.querySelectorAll("#side-tabs button").forEach((button) => {
    button.classList.toggle("on", button.dataset.sideTab === activeSideTab);
  });
  try {
    localStorage.setItem("pt-side-tab", activeSideTab);
  } catch {}
}

document.querySelectorAll("#side-tabs button").forEach((button) => {
  button.addEventListener("click", () => applySideTab(button.dataset.sideTab));
});
applySideTab(activeSideTab);

function archiveSearch() {
  const q = $("archive-search").value.trim().toLowerCase();
  const box = $("archive-search-results");
  box.innerHTML = "";
  if (!q || !session) return;
  const hits = [];
  const add = (title, text) => {
    const value = String(text || "").trim();
    if (!value || !value.toLowerCase().includes(q)) return;
    const index = value.toLowerCase().indexOf(q);
    hits.push({
      title,
      text: (index > 24 ? "…" : "") + value.slice(Math.max(0, index - 24), index + 120),
    });
  };
  for (const entry of session.log || []) {
    const labels = { gm: "剧情正文", player: "玩家行动", dice: "判定", event: "事件", change: "状态变化", sys: "系统" };
    add(labels[entry.type] || "记录", entry.text);
  }
  for (const [name, rel] of Object.entries(session.relations || {})) add(`人物关系 · ${name}`, `${rel.attitude || ""} ${rel.note || ""}`);
  for (const clue of session.clues || []) add("线索", clue);
  for (const npc of session.npcsKnown || []) add("已认识", npc);
  for (const event of [...(session.eventLog || []), ...(session.history || [])]) {
    add(`重要经历 · ${event.title || ""}`, `${event.note || ""} ${event.at || ""}`);
  }
  for (const term of session.scenario?.lexicon || []) add(`词条 · ${term.term || ""}`, term.def || "");
  if (!hits.length) {
    box.appendChild(el("div", "hint", "没有找到匹配内容。"));
    return;
  }
  for (const hit of hits.slice(0, 40)) {
    const row = el("div", "archive-hit");
    row.appendChild(el("b", "", hit.title));
    row.appendChild(el("span", "", hit.text));
    box.appendChild(row);
  }
}

let archiveTimer = 0;
$("archive-search").addEventListener("input", () => {
  clearTimeout(archiveTimer);
  archiveTimer = setTimeout(archiveSearch, 180);
});

const PROTOCOL_KEY = "pt-player-protocol-v1";
const PROTOCOL_DEFAULT = [
  "不替玩家决定行动、台词或内心想法。",
  "世界、人物、能力和时间线保持连续，不无解释地重置。",
  "NPC 按自身目标与知情范围行动，不原地等待玩家发布命令。",
  "危险行动有代价，结果符合世界规则与已建立的能力边界。",
  "不直接泄露幕后真相，只通过可观察、可验证的细节逐步揭示。",
];
let protocolState = { enabled: true, extra: [], confirmMode: "first" };
try {
  const saved = JSON.parse(localStorage.getItem(PROTOCOL_KEY) || "null");
  if (saved) {
    protocolState = {
      enabled: saved.enabled !== false,
      extra: Array.isArray(saved.extra) ? saved.extra.slice(0, 20) : [],
      confirmMode: ["first", "always", "never"].includes(saved.confirmMode) ? saved.confirmMode : "first",
    };
  }
} catch {}

function protocolRules() {
  return [...PROTOCOL_DEFAULT, ...protocolState.extra].slice(0, 25);
}

function renderProtocolSettings() {
  const list = $("protocol-list");
  list.innerHTML = "";
  for (const rule of protocolRules()) {
    const item = el("div", "protocol-item", rule);
    list.appendChild(item);
  }
  $("protocol-enabled").checked = protocolState.enabled;
  if ($("protocol-confirm-mode")) {
    $("protocol-confirm-mode").value = protocolState.confirmMode || "first";
  }
  $("protocol-extra").value = protocolState.extra.join("\n");
}

function saveProtocolSettings() {
  protocolState.enabled = $("protocol-enabled").checked;
  protocolState.confirmMode = ["first", "always", "never"].includes($("protocol-confirm-mode").value)
    ? $("protocol-confirm-mode").value
    : "first";
  protocolState.extra = String($("protocol-extra").value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
  try {
    localStorage.setItem(PROTOCOL_KEY, JSON.stringify(protocolState));
  } catch {}
  renderProtocolSettings();
  $("protocol-status").textContent = "已保存";
  setTimeout(() => ($("protocol-status").textContent = ""), 2000);
}

$("protocol-save").addEventListener("click", saveProtocolSettings);
renderProtocolSettings();

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
  slide("角色卡", `姓名：${c.name}\n称呼：${c.gender || ""}　年龄：${c.age || ""}\n身份：${c.role || ""}\n外貌：${c.appearance || ""}\n性格：${c.personality || ""}\n背景：${c.background || ""}${session.mode === "free" && c.ability ? `\n能力：${c.ability}` : ""}\n目标：${c.goal || ""}\n\n属性：${attrs}\n技能：${skills}`);
  slide("状态与成长", `生命：${session.status?.hp}/${session.status?.hpMax}\n${session.mode === "free" ? "精神" : "理智"}：${session.status?.san}/${session.status?.sanMax}\n金钱：${session.status?.money}\n等级：${g.level || 1}　经验：${g.xp || 0}\n地点：${session.location || "未记录"}\n已认识：${(session.npcsKnown || []).join("、") || "无"}\n\n物品：${(session.inventory || []).join("、") || "空"}\n${session.mode === "free" ? "发现与记录" : "线索"}：${(session.clues || []).join("、") || "无"}`);
  slide("关系与任务", `人物关系：\n${Object.entries(session.relations || {}).map(([k, v]) => `${k}：${v.attitude || ""}（${v.value ?? 0}）${v.note ? " " + v.note : ""}`).join("\n") || "无"}\n\n目标：${(session.objectives || []).map((o) => o.text + (o.done ? "（已完成）" : "")).join("、") || "无"}\n任务：${(session.quests || []).map((o) => o.text + (o.done ? "（已完成）" : "")).join("、") || "无"}`);
  slide("重要经历与历史", `${[...(session.eventLog || []), ...(session.history || [])]
    .map((e) => `${e.at || ""} ${e.title || e.text || ""}${e.note ? "：" + e.note : ""}`)
    .join("\n") || "无"}`);
  const lines = (session.log || []).map((e) => {
    const tag =
      e.type === "player"
        ? "玩家"
        : e.type === "gm"
          ? session.mode === "free" ? "世界" : "GM"
          : e.type === "dice"
            ? "判定"
            : e.type === "event"
              ? "事件"
              : e.type === "change"
                ? "变化"
                : "系统";
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
loadAccountState();
loadMeta();
const landingSection = new URLSearchParams(location.search).get("section");
if (["home", "create", "community", "notice", "profile"].includes(landingSection)) {
  setTimeout(() => document.querySelector(`[data-bottom-nav="${landingSection}"]`)?.click(), 0);
}

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
    ability: $("c-ability").value,
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
  $("c-ability").value = c.ability || "";
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

const SCENARIO_ROW_META = {
  npc: { container: "editor-npcs", count: "count-npcs", empty: "未添加人物", noun: "人物" },
  clue: { container: "editor-clues", count: "count-clues", empty: "未添加线索", noun: "线索" },
  ending: { container: "editor-endings", count: "count-endings", empty: "未添加结局", noun: "结局" },
  entity: { container: "editor-entity-list", count: "count-entities", empty: "未添加实体", noun: "实体" },
  status: { container: "editor-statuses", count: "count-statuses", empty: "未添加状态", noun: "状态" },
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
  if (type === "ending") return value("name") || "新结局";
  if (type === "entity") return value("name") || "新实体";
  if (type === "status") return value("name") || "新持续状态";
  if (type === "lexicon") return value("term") || "新词条";
  if (type === "action") return value("label") || "新预设行动";
  if (type === "random") return value("name") || "新随机项";
  return value("text") || "新开局选项";
}

function scenarioRowMeta(type, data) {
  if (type === "npc") return [data.faction, data.role].filter(Boolean).join(" · ");
  if (type === "clue") return data.category || "";
  if (type === "entity") return [data.group, data.kind].filter(Boolean).join(" · ");
  if (type === "status") return data.initial ? `初始 ${data.initial}` : "";
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

function updateSharedWrap() {
  const wrap = $("s-shared-wrap");
  const select = $("s-visibility");
  if (!wrap || !select) return;
  wrap.classList.toggle("hidden", select.value !== "contacts");
}

$("s-visibility")?.addEventListener("change", updateSharedWrap);

function fillScenarioForm(s) {
  $("s-title").value = s.title || "";
  $("s-genre").value = s.genre || "";
  $("s-blurb").value = s.blurb || "";
  $("s-author").value = s.author || "";
  $("s-duration").value = s.duration || "";
  $("s-players").value = s.players || "";
  $("s-rating").value = s.rating || "";
  $("s-intro").value = s.intro || "";
  $("s-tips").value = s.tips || "";
  scenarioCover = s.cover || "";
  scenarioCoverStyle = normalizeCoverStyle(s.coverStyle);
  syncCoverStyleControls();
  renderCoverPreview();
  $("s-tone").value = s.tone || "";
  $("s-play-style").value = s.playStyle === "open-world" ? "open-world" : "content";
  $("s-version").value = s.version || "1.0";
  $("s-tags").value = (s.tags || []).join(", ");
  $("s-visibility").value = s.visibility === "private" || s.visibility === "contacts" ? s.visibility : "public";
  $("s-shared").value = (s.sharedWith || []).join(", ");
  updateSharedWrap();
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
  $("s-gm-instructions").value = s.gmInstructions || "";
  $("s-fixed-desc").value = rules.fixedOpeningDesc || s.fixedOpeningDesc || s.fixedOpening?.desc || "";
  const legacyStart = s.startDay || s.startMinute !== undefined
    ? `2026-01-${String(Math.max(1, Number(s.startDay) || 1)).padStart(2, "0")}T${minuteToTime(s.startMinute ?? 540)}`
    : "";
  $("s-start-at").value = dateTimeLocalValue(s.startAt || s.startDateTime || legacyStart);
  $("s-money").value = s.startMoney ?? 0;
  $("s-location").value = s.startLocation || "";
  $("s-items").value = (s.startItems || []).join(", ");
  scenarioVisual = normalizeScenarioVisual(s.visual);
  renderScenarioVisualPreview();

  renderScenarioRows("openingOption", s.openingOptions || s.fixedOpening?.options || []);
  renderScenarioRows("entity", s.entities || []);
  renderScenarioRows("status", s.statuses || []);
  renderScenarioRows("npc", s.npcs || []);
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
    cover: scenarioCover,
    coverStyle: {
      fit: $("s-cover-fit")?.value === "contain" ? "contain" : "cover",
      x: Number($("s-cover-x")?.value ?? 50),
      y: Number($("s-cover-y")?.value ?? 50),
      zoom: Number($("s-cover-zoom")?.value ?? 100),
    },
    visual: {
      theme: $("s-visual-theme").value,
      image: scenarioVisual.image,
      accent: $("s-visual-accent").value,
      overlay: Number($("s-visual-overlay").value) || 0,
      blur: Number($("s-visual-blur").value) || 0,
      position: $("s-visual-position").value,
      zoom: Number($("s-visual-zoom")?.value || 100),
    },
    author: $("s-author").value,
    duration: $("s-duration").value,
    players: $("s-players").value,
    rating: $("s-rating").value,
    intro: $("s-intro").value,
    tips: $("s-tips").value,
    tone: $("s-tone").value,
    playStyle: $("s-play-style").value,
    version: $("s-version").value,
    tags: String($("s-tags").value || "").split(/[,，、]/).map((x) => x.trim()).filter(Boolean),
    visibility: $("s-visibility").value === "private" || $("s-visibility").value === "contacts" ? $("s-visibility").value : "public",
    sharedWith: String($("s-shared").value || "").split(/[,，、]/).map((x) => x.trim()).filter(Boolean),
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
    gmInstructions: $("s-gm-instructions").value,
    openingOptions: collectScenarioRows("openingOption"),
    entities: collectScenarioRows("entity"),
    statuses: collectScenarioRows("status"),
    npcs: collectScenarioRows("npc"),
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
  for (const id of ["s-title", "s-genre", "s-blurb", "s-tone", "s-version-note", "s-background", "s-hook", "s-opening", "s-truth", "s-continuity", "s-gm-instructions", "s-world", "s-fixed-desc", "s-location", "s-items", "s-links", "s-author", "s-duration", "s-players", "s-rating", "s-intro", "s-tips"]) {
    $(id).value = "";
  }
  scenarioCover = "";
  scenarioCoverStyle = normalizeCoverStyle({ fit: "cover", x: 50, y: 50, zoom: 100 });
  syncCoverStyleControls();
  renderCoverPreview();
  scenarioVisual = normalizeScenarioVisual({ theme: "night-blue", overlay: 42, accent: "#79aee8" });
  renderScenarioVisualPreview();
  $("s-version").value = "1.0";
  $("s-tags").value = "";
  $("s-visibility").value = SCENARIO_VISIBILITIES_FOR_UI.includes(me?.creatorDefaultVisibility)
    ? me.creatorDefaultVisibility
    : "public";
  $("s-shared").value = "";
  updateSharedWrap();
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
  $("game").classList.remove("on");
  $("setup").classList.remove("hidden");
  setupState.editorDraftAvailable = true;
  $("custom-box").classList.remove("hidden");
  $("editor-main")?.scrollTo?.({ top: 0 });
  $("scenario-editor-sections").scrollTop = 0;
  updateScenarioPreview();
}

function closeScenarioEditor() {
  setupState.editorDraftAvailable = false;
  $("custom-box").classList.add("hidden");
  $("scenario-note").textContent = "";
}

function startNewScenarioDraft() {
  setupState.editingId = null;
  resetScenarioEditor();
  if (!$("s-author").value && me?.name) $("s-author").value = me.name;
  openScenarioEditor();
  $("scenario-note").textContent = "分层创作台已打开；保存后会出现在上面的剧本列表里。";
}

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
  const endings = collectScenarioRows("ending").length;
  const entities = collectScenarioRows("entity").length;
  const statuses = collectScenarioRows("status").length;
  const lexicon = collectScenarioRows("lexicon").length;
  const actions = collectScenarioRows("action").length;
  const randoms = collectScenarioRows("random").length;
  const startAt = $("s-start-at")?.value || "";
  box.innerHTML =
    `<div class="sp-title">${escHtml(title)}</div>` +
    `<div class="sp-genre">v${escHtml(version)} · ${escHtml(genre)}${tags ? " · " + escHtml(tags) : ""}</div>` +
    `<div class="sp-blurb">${escHtml(blurb)}</div>` +
    `<div class="sp-meta">人物 ${npcs} · 实体 ${entities} · 状态 ${statuses} · 线索 ${clues}</div>` +
    `<div class="sp-meta">开始 ${startAt ? escHtml(compactClock(startAt)) : "未设置"} · 动态事件 · 玩家行动驱动时间 · 结局 ${endings}</div>` +
    `<div class="sp-meta">词条 ${lexicon} · 预设行动 ${actions} · 随机项 ${randoms} · 参考链接 ${scenarioLinks.length}</div>`;
  renderScenarioVisualPreview();
}

$("s-start-at")?.addEventListener("input", updateScenarioPreview);
$("s-start-at")?.addEventListener("change", updateScenarioPreview);

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

function applyScenarioEditorScale(compact) {
  $("custom-box").classList.toggle("editor-compact-view", compact);
  $("btn-editor-scale").textContent = compact ? "全屏" : "缩放";
  $("btn-editor-scale").setAttribute("aria-pressed", compact ? "true" : "false");
}

$("btn-editor-scale").addEventListener("click", () => {
  const compact = !$("custom-box").classList.contains("editor-compact-view");
  applyScenarioEditorScale(compact);
  try {
    localStorage.setItem("pt-editor-compact", compact ? "1" : "0");
  } catch {}
});
try {
  applyScenarioEditorScale(localStorage.getItem("pt-editor-compact") === "1");
} catch {
  applyScenarioEditorScale(false);
}

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
    body: JSON.stringify({ id: setupState.editingId, origin: $("share-origin").value }),
  });
  if (data) {
    meta.scenarios = data.scenarios;
    setupState.editingId = null;
    setupState.editorDraftAvailable = false;
    $("custom-box").classList.add("hidden");
    renderScenarios();
    $("scenario-note").textContent = "剧本已删除。";
  }
});

$("btn-share-scenario").addEventListener("click", async () => {
  if (!setupState.editingId) return;
  try {
    const data = await publishScenarioToCommunity(setupState.editingId, $("share-origin").value || "原创");
    $("scenario-note").textContent = data.updated ? "社区推广信息已更新。" : "已发布到创作社区。";
  } catch (error) {
    alert(error.message || "发布失败");
  }
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
  setupState.editorDraftAvailable = false;
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
  slide("动态时间与事件", "本剧本没有预设时间表、循环事件或固定剧情点。时间随玩家行动推进，重要经历在游玩中形成并持续记录。");
  slide("实体与状态", `实体：\n${(d.entities || []).map((e) => `${e.name}｜${e.info}｜初始：${e.initial}｜${e.rules}`).join("\n")}\n\n状态：\n${(d.statuses || []).map((s) => `${s.name} 初始${s.initial}：${s.desc}`).join("\n")}`);
  slide("词条", (d.lexicon || []).map((x) => `${x.term}：${x.def}`).join("\n"));
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

$("btn-refresh-research").addEventListener("click", async () => {
  if (!session) return;
  const button = $("btn-refresh-research");
  button.disabled = true;
  $("research-status").textContent = "正在抓取、比对并审核可信来源…";
  try {
    const response = await fetch("/api/research/sync", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    session.research = data.research;
    renderResearchStatus();
  } catch (error) {
    $("research-status").textContent = `刷新失败：${error.message || error}`;
  } finally {
    button.disabled = false;
  }
});

/* ---------- 剧本封面 ---------- */

let scenarioCover = "";
let scenarioCoverStyle = { fit: "cover", x: 50, y: 50, zoom: 100 };

/** 封面取景：填充方式 + 焦点 + 缩放，创作者可自由裁剪。 */
function normalizeCoverStyle(style) {
  const source = style && typeof style === "object" ? style : {};
  const clamp = (value, lo, hi, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
  };
  return {
    fit: source.fit === "contain" ? "contain" : "cover",
    x: clamp(source.x, 0, 100, 50),
    y: clamp(source.y, 0, 100, 50),
    zoom: clamp(source.zoom, 100, 220, 100),
  };
}

function applyCoverStyle(img, style) {
  if (!img) return;
  const s = normalizeCoverStyle(style);
  img.style.objectFit = s.fit;
  img.style.objectPosition = `${s.x}% ${s.y}%`;
  img.style.transformOrigin = `${s.x}% ${s.y}%`;
  img.style.transform = s.zoom > 100 ? `scale(${s.zoom / 100})` : "";
}
const SCENARIO_VISUAL_PALETTES = {
  "ink-green": { accent: "#77b594", bg: "#07130f", panel: "#10231b", soft: "#163026", line: "#27483a" },
  "warm-brown": { accent: "#d3a46f", bg: "#17110d", panel: "#241a15", soft: "#34261e", line: "#4b392c" },
  "night-blue": { accent: "#79aee8", bg: "#07111f", panel: "#0f1d30", soft: "#172942", line: "#28405e" },
  "violet-night": { accent: "#b18cff", bg: "#110b1a", panel: "#1d1229", soft: "#2a1c3a", line: "#403153" },
  "pure-black": { accent: "#d6c08a", bg: "#000000", panel: "#080808", soft: "#111111", line: "#272727" },
};
let scenarioVisual = {
  theme: "night-blue",
  image: "",
  accent: "#79aee8",
  overlay: 42,
  blur: 0,
  position: "center",
};

function normalizeScenarioVisual(input) {
  const source = input && typeof input === "object" ? input : {};
  const theme = SCENARIO_VISUAL_PALETTES[source.theme] ? source.theme : "night-blue";
  const palette = SCENARIO_VISUAL_PALETTES[theme];
  const clamp = (value, lo, hi, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
  };
  return {
    theme,
    image: /^\/uploads\/[a-f0-9]{16}\.(png|jpg|webp)$/i.test(String(source.image || "")) ? String(source.image) : "",
    accent: /^#[0-9a-f]{6}$/i.test(String(source.accent || "")) ? String(source.accent) : palette.accent,
    overlay: clamp(source.overlay, 0, 90, 42),
    blur: clamp(source.blur, 0, 16, 0),
    position: ["center", "top", "bottom"].includes(source.position) ? source.position : "center",
    zoom: clamp(source.zoom, 100, 200, 100),
    focalX: clamp(source.focalX, 0, 100, 50),
    focalY: clamp(source.focalY, 0, 100, 50),
  };
}

function visualLayerStyle(visual) {
  const v = normalizeScenarioVisual(visual);
  const palette = SCENARIO_VISUAL_PALETTES[v.theme];
  const image = v.image ? `url("${v.image}")` : "none";
  const position = v.position === "top" ? "center top" : v.position === "bottom" ? "center bottom" : "center";
  return {
    palette,
    visual: v,
    background: `linear-gradient(145deg, ${palette.bg}, ${palette.panel})`,
    position,
  };
}

function applyScenarioVisual(input) {
  const game = $("game");
  if (!game) return;
  if (!input || typeof input !== "object") {
    game.removeAttribute("data-scenario-theme");
    for (const name of [
      "--scenario-image",
      "--scenario-background",
      "--scenario-position",
      "--scenario-blur",
      "--scenario-overlay-alpha",
      "--scenario-accent",
      "--accent",
      "--scenario-panel",
      "--scenario-soft",
      "--scenario-line",
    ]) game.style.removeProperty(name);
    return;
  }
  const { visual, palette, background, position } = visualLayerStyle(input);
  game.dataset.scenarioTheme = visual.theme;
  game.style.setProperty("--scenario-image", visual.image ? `url("${visual.image}")` : "none");
  game.style.setProperty("--scenario-background", background);
  game.style.setProperty("--scenario-position", position);
  game.style.setProperty("--scenario-size", visual.zoom > 100 ? `${visual.zoom}% auto` : "cover");
  game.style.setProperty("--scenario-blur", `${visual.blur}px`);
  game.style.setProperty("--scenario-overlay-alpha", String(visual.overlay / 100));
  game.style.setProperty("--scenario-accent", visual.accent || palette.accent);
  game.style.setProperty("--accent", visual.accent || palette.accent);
  game.style.setProperty("--scenario-panel", palette.panel);
  game.style.setProperty("--scenario-soft", palette.soft);
  game.style.setProperty("--scenario-line", palette.line);
}

function renderScenarioVisualPreview() {
  scenarioVisual = normalizeScenarioVisual(scenarioVisual);
  $("s-visual-theme").value = scenarioVisual.theme;
  $("s-visual-accent").value = scenarioVisual.accent;
  $("s-visual-overlay").value = String(scenarioVisual.overlay);
  $("s-visual-blur").value = String(scenarioVisual.blur);
  $("s-visual-position").value = scenarioVisual.position;
  if ($("s-visual-zoom")) $("s-visual-zoom").value = String(scenarioVisual.zoom);
  $("s-visual-image").value = scenarioVisual.image;
  $("s-visual-overlay-value").textContent = `${scenarioVisual.overlay}%`;
  $("s-visual-blur-value").textContent = `${scenarioVisual.blur}px`;
  if ($("s-visual-zoom-value")) $("s-visual-zoom-value").textContent = `${scenarioVisual.zoom}%`;
  const preview = $("s-visual-preview");
  if (preview) {
    const layer = visualLayerStyle(scenarioVisual);
    const image = scenarioVisual.image ? `url("${scenarioVisual.image}"), ` : "";
    preview.style.background = `linear-gradient(rgb(5 8 12 / ${scenarioVisual.overlay / 100}), rgb(5 8 12 / 0.68)), ${image}${layer.background}`;
    preview.style.backgroundSize = scenarioVisual.zoom > 100 ? `${scenarioVisual.zoom}% auto, auto` : "cover";
    preview.style.backgroundPosition = layer.position;
    preview.style.borderColor = scenarioVisual.accent;
  }
  const title = $("s-visual-preview-title");
  if (title) title.textContent = $("s-title").value.trim() || "剧本视觉";
  $("s-visual-note").textContent = scenarioVisual.image
    ? "已设置静态背景图；图片会与所选主体色和遮罩叠加。"
    : "当前仅使用主体色与遮罩。可上传 PNG / JPG / WEBP 静态背景。";
}

function renderCoverPreview() {
  const box = $("s-cover-preview");
  if (!box) return;
  box.innerHTML = "";
  const note = $("s-cover-note");
  if (scenarioCover) {
    const img = document.createElement("img");
    img.src = scenarioCover;
    img.alt = "剧本封面预览";
    applyCoverStyle(img, scenarioCoverStyle);
    box.appendChild(img);
    const gif = /\.gif$/i.test(scenarioCover);
    if (note) note.textContent = gif ? "已设置 GIF 封面（卡片上会动）。" : "已设置静态封面。";
  } else {
    box.appendChild(el("span", "", "还没有封面"));
    if (note) note.textContent = "支持 JPG / PNG / WEBP 与 GIF 动图；下方可以调整裁剪与取景。";
  }
  const hidden = $("s-cover");
  if (hidden) hidden.value = scenarioCover;
}

$("s-cover-file")?.addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const note = $("s-cover-note");
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    if (note) note.textContent = "封面支持 JPG / PNG / WEBP 图片与 GIF 动图。";
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    if (note) note.textContent = "图片不能超过 8MB。";
    return;
  }
  if (note) note.textContent = "正在上传封面…";
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: dataUrl, mime: file.type, kind: "scenario-cover" }),
    });
    const out = await res.json();
    if (!res.ok) {
      if (note) note.textContent = out.error || "上传失败";
      return;
    }
    scenarioCover = out.url;
    renderCoverPreview();
    updateScenarioPreview();
  } catch (err) {
    if (note) note.textContent = "上传失败：" + (err.message || err);
  }
});

$("s-cover-clear")?.addEventListener("click", () => {
  scenarioCover = "";
  renderCoverPreview();
});

/** 封面裁剪控件：填充方式、焦点、缩放 */
function syncCoverStyleControls() {
  const style = normalizeCoverStyle(scenarioCoverStyle);
  if ($("s-cover-fit")) $("s-cover-fit").value = style.fit;
  if ($("s-cover-x")) $("s-cover-x").value = String(style.x);
  if ($("s-cover-y")) $("s-cover-y").value = String(style.y);
  if ($("s-cover-zoom")) $("s-cover-zoom").value = String(style.zoom);
  if ($("s-cover-x-value")) $("s-cover-x-value").textContent = style.x + "%";
  if ($("s-cover-y-value")) $("s-cover-y-value").textContent = style.y + "%";
  if ($("s-cover-zoom-value")) $("s-cover-zoom-value").textContent = style.zoom + "%";
}

function readCoverStyleControls() {
  scenarioCoverStyle = normalizeCoverStyle({
    fit: $("s-cover-fit")?.value,
    x: Number($("s-cover-x")?.value ?? 50),
    y: Number($("s-cover-y")?.value ?? 50),
    zoom: Number($("s-cover-zoom")?.value ?? 100),
  });
  syncCoverStyleControls();
  renderCoverPreview();
}

for (const id of ["s-cover-fit", "s-cover-x", "s-cover-y", "s-cover-zoom"]) {
  $(id)?.addEventListener("input", readCoverStyleControls);
  $(id)?.addEventListener("change", readCoverStyleControls);
}

for (const id of ["s-visual-theme", "s-visual-accent", "s-visual-overlay", "s-visual-blur", "s-visual-position", "s-visual-zoom"]) {
  const syncVisual = () => {
    const theme = $("s-visual-theme").value;
    const accent = id === "s-visual-theme"
      ? (SCENARIO_VISUAL_PALETTES[theme] || SCENARIO_VISUAL_PALETTES["night-blue"]).accent
      : $("s-visual-accent").value;
    scenarioVisual = normalizeScenarioVisual({
      ...scenarioVisual,
      theme,
      accent,
      overlay: Number($("s-visual-overlay").value) || 0,
      blur: Number($("s-visual-blur").value) || 0,
      position: $("s-visual-position").value,
      zoom: Number($("s-visual-zoom")?.value || 100),
    });
    renderScenarioVisualPreview();
  };
  $(id)?.addEventListener("input", syncVisual);
  $(id)?.addEventListener("change", syncVisual);
}

$("s-visual-image-file")?.addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    $("s-visual-note").textContent = "背景只支持 PNG / JPG / WEBP 静态图片。";
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    $("s-visual-note").textContent = "背景图片不能超过 8MB。";
    return;
  }
  $("s-visual-note").textContent = "正在上传背景…";
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: dataUrl, mime: file.type, kind: "scenario-visual" }),
    });
    const data = await response.json();
    if (!response.ok) {
      $("s-visual-note").textContent = data.error || "背景上传失败。";
      return;
    }
    scenarioVisual = normalizeScenarioVisual({ ...scenarioVisual, image: data.url });
    renderScenarioVisualPreview();
  } catch (error) {
    $("s-visual-note").textContent = `背景上传失败：${error.message || error}`;
  }
});

$("s-visual-image-clear")?.addEventListener("click", () => {
  scenarioVisual = normalizeScenarioVisual({ ...scenarioVisual, image: "" });
  renderScenarioVisualPreview();
});

/* ---------- 剧本详情弹窗 ---------- */

const scDetailCache = new Map();
let scDetailId = null;
let scDetailData = null;
let scdCommentSort = "time";
let scdCommentPage = 1;
const SCD_COMMENT_PAGE_SIZE = 8;

function fillChips(boxId, values) {
  const box = $(boxId);
  if (!box) return;
  box.innerHTML = "";
  for (const value of values) box.appendChild(el("span", "scd-chip", value));
  const wrap = box.closest(".scd-section");
  if (wrap) wrap.classList.toggle("hidden", values.length === 0);
}

async function scenarioCommentRequest(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: scDetailId, ...payload }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  if (scDetailData) scDetailData.social = data.social;
  storeScenarioSocial(scDetailId, data.social);
  return data.social;
}

function renderScenarioSocial(social) {
  const actions = $("scd-social-actions");
  const list = $("scd-comments");
  if (!actions || !list) return;
  actions.innerHTML = "";
  const actionDefs = [
    ["like", social?.liked ? "♥" : "♡", social?.likes || 0, "点赞"],
    ["favorite", social?.favorited ? "★" : "☆", social?.favorites || 0, "收藏"],
    ["forward", "↗", social?.shares || 0, "转发"],
  ];
  for (const [kind, icon, count, title] of actionDefs) {
    const button = el("button", "scenario-social-btn" + ((kind === "like" && social?.liked) || (kind === "favorite" && social?.favorited) ? " on" : ""));
    button.type = "button";
    button.title = title;
    button.textContent = `${icon} ${count}`;
    button.addEventListener("click", async () => {
      try {
        if (kind === "forward") {
          await shareScenarioPage(scDetailId, $("scd-status"));
        } else {
          await scenarioSocialAction(kind === "like" ? "/api/scenario/like" : "/api/scenario/favorite", scDetailId);
        }
      } catch (error) {
        $("scd-status").textContent = error.message || String(error);
      }
    });
    actions.appendChild(button);
  }
  actions.appendChild(el("span", "scenario-social-count", `💬 ${social?.commentCount || 0}`));

  list.innerHTML = "";
  if (!social?.comments?.length) {
    const pager = $("scd-comment-pager");
    if (pager) pager.classList.add("hidden");
    list.appendChild(el("div", "fb-empty", "还没有评论，来聊一聊你的想法。"));
    return;
  }
  const ordered = [...social.comments].sort((a, b) => {
    if (scdCommentSort === "hot") {
      const heat = (comment) =>
        (comment.likes || 0) +
        (comment.replies || []).length * 2 +
        (comment.replies || []).reduce((sum, reply) => sum + (reply.likes || 0), 0);
      if (heat(a) !== heat(b)) return heat(b) - heat(a);
    }
    return String(b.at || "").localeCompare(String(a.at || ""));
  });
  const pages = Math.max(1, Math.ceil(ordered.length / SCD_COMMENT_PAGE_SIZE));
  scdCommentPage = Math.max(1, Math.min(pages, scdCommentPage));
  const pageStart = (scdCommentPage - 1) * SCD_COMMENT_PAGE_SIZE;
  const visibleComments = ordered.slice(pageStart, pageStart + SCD_COMMENT_PAGE_SIZE);
  const pager = $("scd-comment-pager");
  if (pager) pager.classList.toggle("hidden", pages <= 1);
  if ($("scd-comments-page")) $("scd-comments-page").textContent = `第 ${scdCommentPage} / ${pages} 页`;
  if ($("scd-comments-prev")) $("scd-comments-prev").disabled = scdCommentPage <= 1;
  if ($("scd-comments-next")) $("scd-comments-next").disabled = scdCommentPage >= pages;

  for (const comment of visibleComments) {
    const thread = el("div", "cm-comment-thread");
    const head = el("div", "cm-comment-meta");
    head.dataset.noI18n = "1";
    head.appendChild(feedbackAvatar(comment.author, comment.avatar));
    head.appendChild(el("span", "", fmtTime(comment.at) + (comment.editedAt ? " · 已编辑" : "")));
    const body = el("div", "cm-comment-body", comment.text || "");
    body.dataset.noI18n = "1";
    const actionsRow = el("div", "social-actions compact");
    const like = el("button", "social-action" + (comment.liked ? " on" : ""), `♥ ${comment.likes || 0}`);
    like.type = "button";
    like.addEventListener("click", () => scenarioCommentRequest("/api/scenario/comment/like", {
      commentId: comment.id,
    }).then((value) => renderScenarioSocial(value)).catch((error) => alert(error.message)));
    actionsRow.appendChild(like);

    const replyBox = el("div", "inline-reply hidden");
    const replyInput = document.createElement("input");
    replyInput.maxLength = 500;
    const replySend = el("button", "", "发送");
    replySend.type = "button";
    let replyToId = "";
    const openReply = (id = "", name = "") => {
      replyToId = id;
      replyInput.placeholder = name ? `回复 ${name}…` : `回复 ${comment.author || "匿名旅人"}…`;
      replyBox.classList.remove("hidden");
      replyInput.focus();
    };
    const replyButton = el("button", "social-action", "回复");
    replyButton.type = "button";
    replyButton.addEventListener("click", () => openReply());
    actionsRow.appendChild(replyButton);
    if (comment.mine) {
      const edit = el("button", "social-action", "编辑");
      edit.type = "button";
      edit.addEventListener("click", async () => {
        const text = prompt("修改评论：", comment.text);
        if (text == null || !text.trim()) return;
        const value = await scenarioCommentRequest("/api/scenario/comment/edit", { commentId: comment.id, text: text.trim() });
        renderScenarioSocial(value);
      });
      const del = el("button", "social-action", "删除");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!confirm("删除这条评论？")) return;
        const value = await scenarioCommentRequest("/api/scenario/comment/delete", { commentId: comment.id });
        renderScenarioSocial(value);
      });
      actionsRow.append(edit, del);
    }

    const replies = el("div", "cm-replies");
    for (const reply of [...(comment.replies || [])].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))) {
      const replyRow = el("div", "cm-reply");
      const replyMeta = el("div", "cm-comment-meta");
      replyMeta.dataset.noI18n = "1";
      replyMeta.appendChild(feedbackAvatar(reply.author, reply.avatar));
      replyMeta.appendChild(el("span", "", fmtTime(reply.at) + (reply.editedAt ? " · 已编辑" : "")));
      const replyText = el("div", "cm-comment-body");
      replyText.dataset.noI18n = "1";
      if (reply.replyToName) replyText.appendChild(el("span", "reply-to", `回复 @${reply.replyToName}：`));
      replyText.appendChild(document.createTextNode(reply.text || ""));
      const replyActions = el("div", "social-actions compact");
      const replyLike = el("button", "social-action" + (reply.liked ? " on" : ""), `♥ ${reply.likes || 0}`);
      replyLike.type = "button";
      replyLike.addEventListener("click", () => scenarioCommentRequest("/api/scenario/comment/like", {
        commentId: comment.id,
        replyId: reply.id,
      }).then((value) => renderScenarioSocial(value)).catch((error) => alert(error.message)));
      const replyAgain = el("button", "social-action", "回复");
      replyAgain.type = "button";
      replyAgain.addEventListener("click", () => openReply(reply.id, reply.author));
      replyActions.append(replyLike, replyAgain);
      if (reply.mine) {
        const edit = el("button", "social-action", "编辑");
        edit.type = "button";
        edit.addEventListener("click", async () => {
          const text = prompt("修改回复：", reply.text);
          if (text == null || !text.trim()) return;
          const value = await scenarioCommentRequest("/api/scenario/comment/edit", { commentId: comment.id, replyId: reply.id, text: text.trim() });
          renderScenarioSocial(value);
        });
        const del = el("button", "social-action", "删除");
        del.type = "button";
        del.addEventListener("click", async () => {
          if (!confirm("删除这条回复？")) return;
          const value = await scenarioCommentRequest("/api/scenario/comment/delete", { commentId: comment.id, replyId: reply.id });
          renderScenarioSocial(value);
        });
        replyActions.append(edit, del);
      }
      replyRow.append(replyMeta, replyText, replyActions);
      replies.appendChild(replyRow);
    }
    replySend.addEventListener("click", async () => {
      const text = replyInput.value.trim();
      if (!text) return;
      try {
        const value = await scenarioCommentRequest("/api/scenario/comment", {
          parentId: comment.id,
          replyToId,
          text,
        });
        renderScenarioSocial(value);
      } catch (error) {
        alert(error.message || error);
      }
    });
    replyBox.append(replyInput, replySend);
    thread.append(head, body, actionsRow);
    if (replies.children.length) thread.appendChild(replies);
    thread.appendChild(replyBox);
    list.appendChild(thread);
  }
}

function renderScenarioDetail(d) {
  scDetailData = d;
  $("scd-title").textContent = d.title || "未命名剧本";
  $("scd-sub").textContent = [d.genre, d.duration, d.players, d.author ? "作者 " + d.author : ""].filter(Boolean).join(" · ");
  $("scd-publish")?.classList.toggle("hidden", !d.mine);
  $("scd-share-origin")?.classList.toggle("hidden", !d.mine);

  const cover = $("scd-cover");
  cover.innerHTML = "";
  if (d.cover) {
    const img = document.createElement("img");
    img.src = d.cover;
    img.alt = "";
    applyCoverStyle(img, d.coverStyle);
    cover.appendChild(img);
  } else {
    cover.appendChild(el("span", "", "封面待补充"));
  }
  cover.appendChild(el("div", "scd-author-badge", `作者 · ${d.author || "匿名作者"}`));

  const facts = $("scd-facts");
  facts.innerHTML = "";
  const rows = [
    ["玩法", d.playStyle === "open-world" ? "自由开放世界" : "内容型剧本"],
    ["可见范围", d.visibility === "private" ? "仅作者可见" : d.visibility === "contacts" ? "指定联系人可见" : "公开"],
    ["版本", d.version ? "v" + d.version : ""],
    ["内容分级", d.rating],
    ["开始地点", d.startLocation],
    ["事件节点", d.scheduleCount ? d.scheduleCount + " 个" : ""],
    ["线索 / 结局", d.clueCount || d.endingCount ? `${d.clueCount} / ${d.endingCount}` : ""],
    ["参考链接", d.linksCount ? d.linksCount + " 条" : ""],
    ["标签", (d.tags || []).join(" · ")],
  ].filter(([, value]) => value);
  for (const [label, value] of rows) {
    const row = el("div", "scd-fact");
    row.appendChild(el("b", "", label));
    row.appendChild(el("span", "", String(value)));
    facts.appendChild(row);
  }

  const fillText = (wrapId, textId, text) => {
    $(textId).textContent = text || "";
    $(wrapId).classList.toggle("hidden", !text);
  };
  fillText("scd-intro-wrap", "scd-intro", d.intro);
  fillText("scd-bg-wrap", "scd-background", d.background);
  fillText("scd-hook-wrap", "scd-hook", [d.hook, d.versionNote].filter(Boolean).join("\n\n"));
  fillText("scd-tips-wrap", "scd-tips", d.tips);
  fillChips("scd-npcs", (d.npcs || []).map((n) => (n.desc ? n.name + "：" + n.desc : n.name)));
  fillChips("scd-openings", d.openings || []);
  renderScenarioSocial(d.social);
}

async function openScenarioDetail(id) {
  const modal = $("sc-detail-modal");
  if (!modal) return;
  scDetailId = id;
  scdCommentPage = 1;
  modal.classList.remove("hidden");
  $("scd-status").textContent = "正在读取剧本资料…";
  try {
    let detail = scDetailCache.get(id);
    if (!detail) {
      const res = await fetch("/api/scenario/detail?id=" + encodeURIComponent(id));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "读取失败");
      detail = data;
      scDetailCache.set(id, detail);
    }
    renderScenarioDetail(detail);
    const socialResponse = await fetch("/api/scenario/social?id=" + encodeURIComponent(id), { cache: "no-store" });
    if (socialResponse.ok) {
      const socialData = await socialResponse.json();
      detail.social = socialData.social;
      scDetailCache.set(id, detail);
      renderScenarioSocial(detail.social);
    }
    $("scd-status").textContent = "";
  } catch (err) {
    $("scd-status").textContent = String(err.message || err);
  }
}

function closeScenarioDetail() {
  $("sc-detail-modal")?.classList.add("hidden");
}

$("scd-close")?.addEventListener("click", closeScenarioDetail);
$("sc-detail-modal")?.addEventListener("click", (event) => {
  if (event.target.id === "sc-detail-modal") closeScenarioDetail();
});
$("scd-pick")?.addEventListener("click", () => {
  const id = scDetailId;
  closeScenarioDetail();
  if (id) {
    scFilter = "all";
    renderScenarios(id);
    $("scenarios")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
$("scd-publish")?.addEventListener("click", async () => {
  if (!scDetailId) return;
  const button = $("scd-publish");
  button.disabled = true;
  $("scd-status").textContent = "正在发布到社区…";
  try {
    const data = await publishScenarioToCommunity(scDetailId, $("scd-share-origin")?.value || "原创");
    $("scd-status").textContent = data.updated ? "社区推广信息已更新。" : "已发布到创作社区。";
  } catch (error) {
    $("scd-status").textContent = error.message || "发布失败";
  } finally {
    button.disabled = false;
  }
});
$("scd-share-link")?.addEventListener("click", async () => {
  if (!scDetailId) return;
  try {
    await shareScenarioPage(scDetailId, $("scd-status"));
  } catch (error) {
    $("scd-status").textContent = error.message || "分享失败";
  }
});
$("scd-comment-sort")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-scd-comment-sort]");
  if (!button) return;
  scdCommentSort = button.dataset.scdCommentSort === "hot" ? "hot" : "time";
  scdCommentPage = 1;
  $("scd-comment-sort").querySelectorAll("button").forEach((item) => item.classList.toggle("on", item === button));
  renderScenarioSocial(scDetailData?.social);
});
$("scd-comments-prev")?.addEventListener("click", () => {
  if (scdCommentPage <= 1) return;
  scdCommentPage -= 1;
  renderScenarioSocial(scDetailData?.social);
  $("scd-comments")?.scrollTo({ top: 0, behavior: "smooth" });
});
$("scd-comments-next")?.addEventListener("click", () => {
  const total = scDetailData?.social?.comments?.length || 0;
  const pages = Math.max(1, Math.ceil(total / SCD_COMMENT_PAGE_SIZE));
  if (scdCommentPage >= pages) return;
  scdCommentPage += 1;
  renderScenarioSocial(scDetailData?.social);
  $("scd-comments")?.scrollTo({ top: 0, behavior: "smooth" });
});
$("scd-comment-send")?.addEventListener("click", async () => {
  const text = $("scd-comment-input").value.trim();
  if (!text || !scDetailId) return;
  try {
    const social = await scenarioCommentRequest("/api/scenario/comment", { text });
    $("scd-comment-input").value = "";
    scdCommentPage = 1;
    renderScenarioSocial(social);
    renderScenarios(scDetailId);
  } catch (error) {
    $("scd-status").textContent = error.message || String(error);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("sc-detail-modal")?.classList.contains("hidden")) closeScenarioDetail();
});
