(() => {
  const ESCAPE = Object.freeze({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    "\"":"&quot;",
    "'":"&#39;"
  });

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ESCAPE[character]);
  }

  function safeHttpUrl(value, fallback = "") {
    const raw = String(value ?? "").trim();
    if (!raw) return fallback;
    try {
      const parsed = new URL(raw, window.location.href);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
    } catch {}
    return fallback;
  }

  window.LocalBleachersSecurity = Object.freeze({ escapeHtml, safeHttpUrl });
})();
