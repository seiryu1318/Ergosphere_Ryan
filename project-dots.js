(() => {
  const lifetime = 15 * 24 * 60 * 60 * 1000;
  const refreshInterval = 30 * 60 * 1000;
  const storageKey = "ryan-project-publication-times-v1";
  const manifest = "https://raw.githubusercontent.com/seiryu1318/Ergosphere_Ryan/main/project-updates.json";
  const links = [...document.querySelectorAll(".category-project-link, .mobile-category-link")];
  const projects = Object.create(null);
  let expiryTimer;
  let pending = false;
  let lastRefresh = 0;

  function remember(dates) {
    for (const link of links) {
      const id = link.dataset.project;
      const published = Date.parse(dates?.[id]);
      if (Number.isFinite(published) && published <= Date.now()) {
        projects[id] = Math.max(projects[id] || 0, published);
      }
    }
  }

  function render() {
    const now = Date.now();
    let nextExpiry = Infinity;
    for (const link of links) {
      const expiry = projects[link.dataset.project] + lifetime;
      const active = expiry > now;
      link.classList.toggle("has-work-change", active);
      if (active) nextExpiry = Math.min(nextExpiry, expiry);
    }
    document.querySelectorAll("[data-category-column], .mobile-menu-category").forEach(section => {
      const active = Boolean(section.querySelector("a.has-work-change"));
      const trigger = section.matches("details") ? section.querySelector("summary")
        : document.querySelector('.category-trigger[data-category="' + section.dataset.categoryColumn + '"]');
      trigger?.classList.toggle("has-work-change", active);
      section.querySelector("h2")?.classList.toggle("has-work-change", active);
    });
    clearTimeout(expiryTimer);
    if (Number.isFinite(nextExpiry)) expiryTimer = setTimeout(render, nextExpiry - now);
  }

  async function refresh() {
    render();
    if (pending || document.hidden || Date.now() - lastRefresh < refreshInterval) return;
    pending = true;
    try {
      for (const url of [manifest, "./project-updates.json"]) {
        try {
          const response = await fetch(url, {cache: "no-cache", signal: AbortSignal.timeout(8000)});
          if (!response.ok) continue;
          const payload = await response.json();
          if (!payload.projects || typeof payload.projects !== "object") continue;
          remember(payload.projects);
          render();
          const dates = Object.fromEntries(Object.entries(projects).map(([id, time]) => [id, new Date(time).toISOString()]));
          try { localStorage.setItem(storageKey, JSON.stringify(dates)); } catch {}
          lastRefresh = Date.now();
          break;
        } catch { /* Try the copy served with the portal when GitHub is unavailable. */ }
      }
    } finally {
      pending = false;
    }
  }

  try { remember(JSON.parse(localStorage.getItem(storageKey))); } catch {}
  refresh();
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("online", refresh);
  setInterval(refresh, refreshInterval);
})();
