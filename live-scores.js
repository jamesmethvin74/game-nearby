(() => {
  const LOCALBLEACHERS_SCORESTREAM_WIDGET_ID = "70169";
  const PUBLIC_ARKANSAS_FOOTBALL_URL = "https://scorestream.com/explore/r/arkansas/high-school/football/scores";

  function showFallback() {
    const host = document.getElementById("scorestreamHost");
    if (!host) return;
    host.innerHTML = `
      <div class="scorestream-empty">
        <div class="scorestream-empty-inner">
          <h2>ScoreStream is temporarily unavailable</h2>
          <p>The Live Scores page uses ScoreStream's published interface only. LocalBleachersAR does not scrape or ingest this display into D1.</p>
          <div class="scorestream-actions">
            <a class="scorestream-btn primary" href="${PUBLIC_ARKANSAS_FOOTBALL_URL}" target="_blank" rel="noopener noreferrer">Open Arkansas live scores</a>
          </div>
        </div>
      </div>`;
  }

  function loadWidget() {
    const host = document.getElementById("scorestreamHost");
    const status = document.getElementById("scorestreamStatus");
    const error = document.getElementById("scorestreamError");
    if (!host) return;

    host.innerHTML = "";
    const container = document.createElement("div");
    container.className = "scorestream-widget-container";
    container.dataset.ss_widget_type = "vertScoreboard";
    container.dataset.userWidgetId = LOCALBLEACHERS_SCORESTREAM_WIDGET_ID;
    host.appendChild(container);

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://scorestream.com/apiJsCdn/widgets/embed.js";
    script.onload = () => {
      if (status) status.textContent = "Official LocalBleachersAR ScoreStream widget";
    };
    script.onerror = () => {
      if (error) {
        error.hidden = false;
        error.textContent = "ScoreStream did not load. Open the Arkansas scoreboard directly and try again later.";
      }
      showFallback();
    };
    document.body.appendChild(script);
  }

  loadWidget();
})();
