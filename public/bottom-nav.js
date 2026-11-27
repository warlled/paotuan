(() => {
  if (document.getElementById("bottom-nav")) return;

  const items = [
    ["home", "主页", '<path fill="currentColor" d="M12 3 2.5 11h3V21h5v-6h3v6h5v-10h3L12 3z"/>'],
    ["create", "剧本创作", '<path fill="currentColor" d="m4 16.7-.8 4.1 4.1-.8L19 8.3 15.7 5 4 16.7zM17 3.6l1-1a1.4 1.4 0 0 1 2 0l1.4 1.4a1.4 1.4 0 0 1 0 2l-1 1L17 3.6z"/>'],
    ["community", "社区", '<path fill="currentColor" d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3 5v2h10V8H7zm0 4v2h7v-2H7z"/>'],
    ["notice", "官方公告与投诉反馈", '<path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.4-2h-4.8a2.5 2.5 0 0 0 2.4 2zm7-6v-5a7 7 0 0 0-5-6.7V3a2 2 0 0 0-4 0v1.3A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2z"/>'],
    ["profile", "个人", '<path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5C21 16.5 17 14 12 14z"/>'],
  ];
  const params = new URLSearchParams(location.search);
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const mainPage = path === "/" || path === "/index.html" || path.startsWith("/scenario/");
  const requested = params.get("section") || (path === "/space" ? "profile" : "home");
  const key = params.get("k");
  const nav = document.createElement("nav");
  nav.id = "bottom-nav";
  nav.setAttribute("aria-label", "主要栏目");

  for (const [section, label, icon] of items) {
    const item = document.createElement(mainPage ? "button" : "a");
    if (mainPage) item.type = "button";
    item.dataset.bottomNav = section;
    item.setAttribute("aria-label", label);
    if (!mainPage) item.href = `/?section=${encodeURIComponent(section)}${key ? `&k=${encodeURIComponent(key)}` : ""}`;
    if (section === requested) {
      item.classList.add("on");
      item.setAttribute("aria-current", "page");
    }
    item.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span>`;
    nav.appendChild(item);
  }
  document.body.appendChild(nav);
})();
