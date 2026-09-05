(() => {
  const WIDGET_STORAGE_KEY = "localBleachersAR:scorestreamWidgetId";
  const PUBLIC_ARKANSAS_FOOTBALL_URL = "https://scorestream.com/explore/r/arkansas/high-school/football/scores";
  // Proof-only default: High School Football America's current 2026 Arkansas page
  // publicly embeds this ScoreStream widget. Replace with a LocalBleachers-owned
  // free widget ID before production merge.
  const PUBLIC_ARKANSAS_PROOF_WIDGET_ID = "2081";

  function validWidgetId(value) {
    const id = String(value || "").trim();
    return /^\d{2,10}$/.test(id) ? id : "";
  }

  function resolvedWidgetId() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = validWidgetId(params.get("widget"));
    if (fromQuery) {
      try { localStorage.setItem(WIDGET_STORAGE_KEY, fromQuery); } catch {}
      return fromQuery;
    }
    try {
      return validWidgetId(localStorage.getItem(WIDGET_STORAGE_KEY)) || PUBLIC_ARKANSAS_PROOF_WIDGET_ID;
    } catch {
      return PUBLIC_ARKANSAS_PROOF_WIDGET_ID;
    }
  }

  function showFallback() {
    const host = document.getElementById("scorestreamHost");
    if (!host) return;
    host.innerHTML = `
      <div class="scorestream-empty">
        <div class="scorestream-empty-inner">
          <h2>ScoreStream is temporarily unavailable</h2>
          <p>The Live Scores experiment only uses ScoreStream's published interface. No scraping and no production D1 writes are involved.</p>
          <div class="scorestream-actions">
            <a class="scorestream-btn primary" href="${PUBLIC_ARKANSAS_FOOTBALL_URL}" target="_blank" rel="noopener noreferrer">Open Arkansas live scores</a>
          </div>
        </div>
      </div>`;
  }

  function loadWidget(widgetId) {
    const host = document.getElementById("scorestreamHost");
    const status = document.getElementById("scorestreamStatus");
    const error = document.getElementById("scorestreamError");
    if (!host) return;

    host.innerHTML = "";
    const container = document.createElement("div");
    container.className = "scorestream-widget-container";
    container.dataset.ss_widget_type = "vertScoreboard";
    container.dataset.userWidgetId = widgetId;
    host.appendChild(container);

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://scorestream.com/apiJsCdn/widgets/embed.js";
    script.onload = () => {
      if (status) {
        status.textContent = widgetId === PUBLIC_ARKANSAS_PROOF_WIDGET_ID
          ? "ScoreStream Arkansas proof widget"
          : `Official ScoreStream widget #${widgetId}`;
      }
    };
    script.onerror = () => {
      if (error) {
        error.hidden = false;
        error.textContent = "ScoreStream did not load. Use the Arkansas scoreboard link below and try again later.";
      }
      showFallback();
    };
    document.body.appendChild(script);
  }

  loadWidget(resolvedWidgetId());
})();
