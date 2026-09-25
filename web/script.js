const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const basePath = isLocal ? "../" : "";

const CONFIG = {
  rankDataUrl: `${basePath}data/rank_data.csv`,
  seasonsUrl: `${basePath}data/seasons.csv`,
  colors: ["#ff2aa3", "#5d37e8", "#ff7138", "#1ca9df", "#69b92f"],
  leagueScore: {
    bronze: 0,
    silver: 10000,
    gold: 20000,
    platinum: 30000,
    diamond: 40000,
    ruby: 50000,
  },
};
const CHART_COLORS = { diamond: "#b996ff", ruby: "#ff5c83" };

const state = {
  records: [],
  seasons: {},
  currentSeason: "",
  metric: "score",
  selectedPlayer: "",
  hiddenPlayers: new Set(),
  colors: new Map(),
};
const $ = (selector) => document.querySelector(selector);
const formatNumber = (value) =>
  Number.isFinite(value) ? Math.round(value).toLocaleString() : "--";
const formatDelta = (value, suffix = "") => {
  if (!Number.isFinite(value) || value === 0) return "No change";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}${suffix}`;
};
const asNumber = (value) => {
  const number = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(number) ? number : null;
};

function parseCsv(text) {
  // The data files are small and served as static assets, so a focused parser
  // keeps the app dependency-free while still handling quoted CSV cells.
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && text[index + 1] === '"' && quoted) {
      cell += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows
    .shift()
    .map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.map((values) =>
    headers.reduce(
      (record, header, index) => ({ ...record, [header]: values[index] ?? "" }),
      {},
    ),
  );
}

function normalizeRecord(row) {
  const player = String(row.steamName || row.player || row.name || "").trim();
  const season = String(row.season || "")
    .trim()
    .toUpperCase();
  const recordedAt = String(row.recordedAt || row.date || "").trim();
  if (!player || !season || !recordedAt) return null;
  return {
    player,
    season,
    recordedAt,
    date: recordedAt.split(/[ T]/)[0],
    score: asNumber(row.rankScore ?? row.score),
    rank: asNumber(row.rank),
    league: String(row.league || "").trim() || "Unranked",
  };
}

async function loadData() {
  // Load both files together; rank data is required, while season metadata is
  // optional because the chart can still work from the records alone.
  try {
    const [rankResponse, seasonResponse] = await Promise.all([
      fetch(CONFIG.rankDataUrl),
      fetch(CONFIG.seasonsUrl),
    ]);
    if (!rankResponse.ok)
      throw new Error(`Rank data returned ${rankResponse.status}`);
    const [rankText, seasonText] = await Promise.all([
      rankResponse.text(),
      seasonResponse.ok ? seasonResponse.text() : Promise.resolve(""),
    ]);
    state.records = parseCsv(rankText)
      .map(normalizeRecord)
      .filter(Boolean)
      .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
    parseCsv(seasonText).forEach((row) => {
      if (row.season)
        state.seasons[String(row.season).toUpperCase()] = {
          start: row.startDate,
          end: row.endDate,
        };
    });
    if (!state.records.length)
      throw new Error("The rank CSV contains no usable records.");
    state.currentSeason = [
      ...new Set(state.records.map((record) => record.season)),
    ].at(-1);
    setStatus(`Tracking ${state.records.length} snapshots`);
    populateSeasonSelect();
    render();
  } catch (error) {
    console.error(error);
    setStatus("Data connection failed", true);
    $("#errorPanel").hidden = false;
    $("#errorMessage").textContent =
      `${error.message} Check data/rank_data.csv and reload.`;
    $("#chartEmpty").hidden = false;
  }
}

function setStatus(message, isError = false) {
  $("#dataStatus").textContent = message;
  $(".status-dot").style.background = isError ? "#ff2aa3" : "#c8ff32";
}
function populateSeasonSelect() {
  const select = $("#seasonSelect");
  select.innerHTML = [...new Set(state.records.map((record) => record.season))]
    .map((season) => `<option value="${season}">${season}</option>`)
    .join("");
  select.value = state.currentSeason;
  select.onchange = (event) => {
    state.currentSeason = event.target.value;
    state.selectedPlayer = "";
    state.hiddenPlayers.clear();
    render();
  };
}
function recordsForSeason(season) {
  return state.records.filter((record) => record.season === season);
}
function playerRecords(player, season) {
  return recordsForSeason(season).filter((record) => record.player === player);
}
function latestByPlayer(records) {
  return [...records]
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt))
    .reduce((result, record) => {
      result.set(record.player, record);
      return result;
    }, new Map());
}
function previousSeason(season, player) {
  const seasons = [...new Set(state.records.map((record) => record.season))];
  const index = seasons.indexOf(season);
  return (
    seasons
      .slice(0, index)
      .reverse()
      .find((candidate) => playerRecords(player, candidate).length) || ""
  );
}
function colorFor(player, index = 0) {
  if (!state.colors.has(player))
    state.colors.set(player, CONFIG.colors[index % CONFIG.colors.length]);
  return state.colors.get(player);
}

function render() {
  const seasonRecords = recordsForSeason(state.currentSeason);
  const latest = latestByPlayer(seasonRecords);
  const players = [...latest.keys()].sort(
    (firstPlayer, secondPlayer) =>
      (latest.get(firstPlayer).rank ?? Infinity) -
      (latest.get(secondPlayer).rank ?? Infinity),
  );
  players.forEach((player, index) => colorFor(player, index));
  renderStats(seasonRecords, latest);
  renderCards(players, latest);
  renderChart(players);
  renderComparison();
  const newest = state.records.at(-1)?.recordedAt;
  $("#lastUpdated").textContent = newest
    ? `Last update: ${new Date(newest.replace(" ", "T")).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
    : "Last update: --";
}

function renderStats(records, latest) {
  // Stats use the first and latest snapshot for each player in the selected
  // season, keeping the cards aligned with the chart's current season.
  const best = [...latest.values()]
    .filter((record) => Number.isFinite(record.rank))
    .sort((a, b) => a.rank - b.rank)[0];
  const topScore = [...records]
    .filter((record) => Number.isFinite(record.score))
    .sort((a, b) => b.score - a.score)[0];
  const first = new Map();
  records.forEach((record) => {
    if (!first.has(record.player)) first.set(record.player, record);
  });
  const climbs = [...latest]
    .map(([player, record]) => ({
      player,
      climb: record.score - (first.get(player)?.score ?? record.score),
    }))
    .filter(({ climb }) => Number.isFinite(climb))
    .sort((a, b) => b.climb - a.climb);
  const scoreMomentum = climbs.reduce((sum, { climb }) => sum + climb, 0);
  const largestClimb = climbs[0];
  $("#bestRank").textContent = best ? `#${formatNumber(best.rank)}` : "--";
  $("#bestRankSub").textContent = best?.player || "Waiting for data";
  $("#highestScore").textContent = formatNumber(topScore?.score);
  $("#highestScoreSub").textContent = topScore?.player || "Waiting for data";
  $("#momentum").textContent = formatDelta(scoreMomentum);
  $("#momentumSub").textContent =
    scoreMomentum >= 0 ? "Score gained this season" : "Score lost this season";
  $("#snapshotCount").textContent = largestClimb
    ? formatDelta(largestClimb.climb)
    : "--";
  $("#snapshotSub").textContent = largestClimb?.player || "Waiting for data";
}

function renderCards(players, latest) {
  $("#playerCards").innerHTML =
    players
      .map((player, index) => {
        const current = latest.get(player);
        const history = playerRecords(player, state.currentSeason);
        const previous = history.at(-2);
        const scoreDelta = current.score - previous?.score;
        const rankDelta = previous?.rank - current.rank;
        const playerColor = colorFor(player, index);
        const scoreProgress =
          current.score && CONFIG.leagueScore.diamond
            ? Math.min(
                100,
                Math.max(5, (current.score / CONFIG.leagueScore.diamond) * 100),
              )
            : 8;
        return `<article class="player-card ${state.selectedPlayer === player ? "is-selected" : ""}" data-player="${encodeURIComponent(player)}" style="border-color:${playerColor}"><div class="player-name"><span>${player}</span><span class="player-rank">${current.rank ? `#${formatNumber(current.rank)}` : "Unranked"}<small class="player-diff" style="color:${playerColor}">${formatDelta(rankDelta)}</small></span></div><div class="player-meta"><span>${current.league}</span><span class="player-score">${formatNumber(current.score)} score <small class="player-diff" style="color:${playerColor}">${formatDelta(scoreDelta)}</small></span></div><div class="progress"><span style="width:${scoreProgress}%;background:${playerColor}"></span></div></article>`;
      })
      .join("") || '<p class="muted-text">No players found.</p>';
  document.querySelectorAll(".player-card").forEach((card) => {
    card.onclick = () => {
      state.selectedPlayer = decodeURIComponent(card.dataset.player);
      render();
    };
  });
}

function renderComparison() {
  const player = state.selectedPlayer;
  if (!player) {
    $("#comparisonNote").textContent =
      "Select a player to compare their seasons.";
    $("#comparisonGrid").innerHTML =
      '<p class="muted-text">Player history appears here when selected.</p>';
    return;
  }
  const current = state.currentSeason;
  const previous = previousSeason(current, player);
  const currentLast = playerRecords(player, current).at(-1);
  const previousLast = previous ? playerRecords(player, previous).at(-1) : null;
  $("#comparisonNote").textContent =
    `${player} · ${current}${previous ? ` versus ${previous}` : ""}`;
  const scoreChange = currentLast?.score - previousLast?.score;
  const rankChange = previousLast?.rank - currentLast?.rank;
  $("#comparisonGrid").innerHTML =
    `<div class="comparison-item"><h3>${current} / latest</h3><div class="comparison-stats"><div><span>Rank</span><strong>${currentLast?.rank ? `#${formatNumber(currentLast.rank)}` : "--"}</strong></div><div><span>Score</span><strong>${formatNumber(currentLast?.score)}</strong></div><div><span>League</span><strong>${currentLast?.league || "--"}</strong></div><div><span>Snapshots</span><strong>${playerRecords(player, current).length}</strong></div></div></div>${previousLast ? `<div class="comparison-item"><h3>${previous} / latest</h3><div class="comparison-stats"><div><span>Rank</span><strong>#${formatNumber(previousLast.rank)}</strong></div><div><span>Score</span><strong>${formatNumber(previousLast.score)}</strong></div><div><span>Rank change</span><strong class="${rankChange >= 0 ? "delta-up" : "delta-down"}">${formatDelta(rankChange)}</strong></div><div><span>Score change</span><strong class="${scoreChange >= 0 ? "delta-up" : "delta-down"}">${formatDelta(scoreChange)}</strong></div></div></div>` : '<div class="comparison-item"><h3>Earlier seasons</h3><p class="muted-text">No earlier season snapshot found for this player.</p></div>'}`;
}

function renderChart(players) {
  const canvas = $("#rankChart");
  const empty = $("#chartEmpty");
  const context = canvas.getContext("2d");
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, bounds.width * ratio);
  canvas.height = Math.max(1, bounds.height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = bounds.width;
  const height = bounds.height;
  context.clearRect(0, 0, width, height);
  const visible = players.filter((player) => !state.hiddenPlayers.has(player));
  const allRecords = recordsForSeason(state.currentSeason);
  const values = allRecords
    .map((record) => record[state.metric])
    .filter(Number.isFinite);
  if (!values.length) {
    empty.hidden = false;
    $("#chartLegend").innerHTML = "";
    return;
  }
  empty.hidden = true;
  // Use fixed, meaningful increments so score and rank charts remain readable
  // when switching seasons with very different value ranges.
  const left = state.metric === "rank" ? 58 : 66;
  const top = 18;
  const right = 18;
  const bottom = 34;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const step = state.metric === "rank" ? 500 : 2500;
  const min =
    state.metric === "rank" ? 1 : Math.floor(Math.min(...values) / step) * step;
  const max =
    state.metric === "rank"
      ? Math.max(750, Math.ceil(Math.max(...values) / step) * step)
      : Math.max(40000 + step, Math.ceil(Math.max(...values) / step) * step);
  const range = max - min || 1;
  const points = allRecords
    .filter((record) => Number.isFinite(record[state.metric]))
    .map((record) => ({
      ...record,
      timestamp: new Date(record.recordedAt.replace(" ", "T")).getTime(),
    }))
    .filter((record) => Number.isFinite(record.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const startTime = points[0].timestamp;
  const endTime = points.at(-1).timestamp;
  const timeRange = endTime - startTime || 1;
  const xFor = (record) =>
    left + (chartWidth * (record.timestamp - startTime)) / timeRange;
  context.font = "11px Space Grotesk";
  context.strokeStyle = "#e2e0da";
  context.fillStyle = "#898691";
  context.lineWidth = 1;
  const valueToY = (value) =>
    top +
    chartHeight *
      (state.metric === "rank" ? (value - min) / range : (max - value) / range);
  // League shading is drawn before grid lines and player paths. Diamond is
  // above 40,000; Ruby is above rank 500 because rank 1 is at the top.
  const bandTop =
    state.metric === "rank" ? top : valueToY(CONFIG.leagueScore.diamond);
  context.fillStyle = "#ffffff";
  context.fillRect(left, top, chartWidth, chartHeight);
  context.fillStyle =
    state.metric === "rank"
      ? `${CHART_COLORS.ruby}18`
      : `${CHART_COLORS.diamond}22`;
  context.fillRect(
    left,
    top,
    chartWidth,
    state.metric === "rank" ? valueToY(500) - top : Math.max(0, bandTop - top),
  );
  const ticks =
    state.metric === "rank"
      ? [
          1,
          ...Array.from(
            { length: Math.floor((max - 1) / step) },
            (_, index) => (index + 1) * step,
          ),
        ]
      : Array.from(
          { length: Math.floor((max - min) / step) + 1 },
          (_, index) => min + index * step,
        );
  ticks.forEach((value) => {
    const y = valueToY(value);
    context.strokeStyle = "#e2e0da";
    context.fillStyle = "#898691";
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();
    context.fillText(formatNumber(value), 3, y + 4);
  });
  const labelIndexes =
    points.length <= 7
      ? points.map((_, index) => index)
      : [
          0,
          ...Array.from({ length: 5 }, (_, index) =>
            Math.round(((index + 1) * (points.length - 1)) / 6),
          ),
          points.length - 1,
        ];
  [...new Set(labelIndexes)].forEach((index) => {
    const point = points[index];
    const label = new Date(point.timestamp).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
    context.fillText(label, xFor(point) - 16, height - 8);
  });
  visible.forEach((player) => {
    const records = playerRecords(player, state.currentSeason)
      .filter((record) => Number.isFinite(record[state.metric]))
      .map((record) => ({
        ...record,
        timestamp: new Date(record.recordedAt.replace(" ", "T")).getTime(),
      }))
      .filter((record) => Number.isFinite(record.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp);
    context.strokeStyle = colorFor(player);
    context.lineWidth = state.selectedPlayer === player ? 3 : 2;
    context.beginPath();
    records.forEach((record, index) => {
      const x = xFor(record);
      const value = state.metric === "rank" ? record.rank : record.score;
      const y = valueToY(value);
      index ? context.lineTo(x, y) : context.moveTo(x, y);
    });
    context.stroke();
  });
  // Canvas has no native DOM points, so keep a parallel list of plotted points
  // and use nearest-point hit testing for the HTML tooltip.
  const hoverPoints = visible.flatMap((player) => {
    const history = playerRecords(player, state.currentSeason)
      .filter(
        (record) =>
          Number.isFinite(record.score) && Number.isFinite(record.rank),
      )
      .map((record) => ({
        ...record,
        timestamp: new Date(record.recordedAt.replace(" ", "T")).getTime(),
      }))
      .filter((record) => Number.isFinite(record.timestamp))
      .map((record) => ({
        record,
        x: xFor(record),
        y: valueToY(state.metric === "rank" ? record.rank : record.score),
      }));
    const pointsByTime = history.sort((a, b) => a.timestamp - b.timestamp);
    return pointsByTime.map((point, index) => ({
      ...point,
      previous: pointsByTime[index - 1]?.record,
    }));
  });
  const tooltip = $("#chartTooltip");
  canvas.onmousemove = (event) => {
    const bounds = canvas.getBoundingClientRect();
    const pointer = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const nearest = hoverPoints.reduce((best, point) => {
      const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
      return !best || distance < best.distance ? { ...point, distance } : best;
    }, null);
    if (!nearest || nearest.distance > 18) {
      tooltip.hidden = true;
      return;
    }
    const { record, previous } = nearest;
    const playerColor = colorFor(record.player);
    const snapshotDate = new Date(record.timestamp).toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const scoreDelta = record.score - previous?.score;
    const rankDelta = previous?.rank - record.rank;
    tooltip.textContent = `${snapshotDate} | ${record.player} | Score ${formatNumber(record.score)} (${formatDelta(scoreDelta)}) | Rank #${formatNumber(record.rank)} (${formatDelta(rankDelta)})`;
    tooltip.style.background = playerColor;
    tooltip.style.boxShadow = `4px 4px 0 ${playerColor}`;
    tooltip.hidden = false;
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const halfWidth = tooltipWidth / 2;
    tooltip.style.left = `${Math.min(Math.max(nearest.x, halfWidth + 6), width - halfWidth - 6)}px`;
    tooltip.style.top = `${Math.min(Math.max(nearest.y - tooltipHeight - 10, 6), height - tooltipHeight - 6)}px`;
  };
  canvas.onmouseleave = () => {
    tooltip.hidden = true;
  };
  $("#chartLegend").innerHTML = players
    .map(
      (player) =>
        `<button class="legend-button ${state.hiddenPlayers.has(player) ? "is-muted" : ""}" data-player="${encodeURIComponent(player)}"><span class="legend-swatch" style="background:${colorFor(player)}"></span>${player}</button>`,
    )
    .join("");
  document.querySelectorAll(".legend-button").forEach((button) => {
    button.onclick = () => {
      const player = decodeURIComponent(button.dataset.player);
      state.hiddenPlayers.has(player)
        ? state.hiddenPlayers.delete(player)
        : state.hiddenPlayers.add(player);
      renderChart(players);
    };
  });
}

// Metric buttons redraw the same data with a different y-axis scale.
document.querySelectorAll(".metric-button").forEach((button) => {
  button.onclick = () => {
    state.metric = button.dataset.metric;
    document
      .querySelectorAll(".metric-button")
      .forEach((item) => item.classList.toggle("is-active", item === button));
    renderChart([
      ...latestByPlayer(recordsForSeason(state.currentSeason)).keys(),
    ]);
  };
});
window.addEventListener("resize", () => {
  if (state.records.length)
    renderChart([
      ...latestByPlayer(recordsForSeason(state.currentSeason)).keys(),
    ]);
});
loadData();
