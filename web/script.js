// Check if the page is being served from localhost or a local file, and adjust
// the base path for data files accordingly. GitHub Pages copies data/ into the
// published web/ root, so there the paths are relative to the page itself.
const isLocal =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const basePath = isLocal ? "../" : "";

const DAY_MS = 86400000;
// Every league division in The Finals is a 2,500-point band, and leagueNumber
// maps onto it linearly: floor = (leagueNumber - 1) * 2500. So #17 starts at
// 40,000 and is Diamond 4. That makes a 2,500 gridline and a division boundary
// the same line, which is why the score axis steps by exactly 2,500.
const LEAGUE_STEP = 2500;
const LEAGUE_TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"];
// The mapped bands stop at Diamond 1 (leagueNumber 20, index 19), whose band
// runs 47,500-50,000. Nothing opens at 50,000: Ruby is a top-500 placement, not
// a score band, so no division is named there and Diamond 1 has no next.
const TOP_INDEX = 19;
// The rank axis steps by a flat 1,000 places. Unlike score it has no division
// structure to borrow, but a fixed round step keeps the gridlines comparable
// from one season to the next instead of resizing with the data.
const RANK_STEP = 1000;
// Chart figures use the same mono as the panels, so an axis reading and a
// standings reading look like the same instrument.
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const TIER_VARS = {
  Bronze: "--tier-bronze",
  Silver: "--tier-silver",
  Gold: "--tier-gold",
  Platinum: "--tier-platinum",
  Diamond: "--tier-diamond",
  Ruby: "--tier-ruby",
};

const CONFIG = {
  rankDataUrl: `${basePath}data/rank_data.csv`,
  seasonsUrl: `${basePath}data/seasons.csv`,
  // The eight categorical slots, validated on the adjacent pairlist against
  // both surfaces. A hue belongs to a player for good: filtering or re-ranking
  // never repaints it.
  seriesVars: [
    "--series-1",
    "--series-2",
    "--series-3",
    "--series-4",
    "--series-5",
    "--series-6",
    "--series-7",
    "--series-8",
  ],
  themeKey: "hsd-theme",
  svgNs: "http://www.w3.org/2000/svg",
};

const state = {
  records: [],
  seasons: {},
  seasonList: [],
  season: "",
  metric: "score",
  players: [],
  focused: "",
  plot: null,
  hoverKey: null,
};

const $ = (selector) => document.querySelector(selector);

/* --------------------------------------------------------------------------
   Formatting helpers
   -------------------------------------------------------------------------- */
const formatNumber = (value) =>
  Number.isFinite(value) ? Math.round(value).toLocaleString() : "--";

const formatRank = (value) =>
  Number.isFinite(value) ? `#${formatNumber(value)}` : "--";

const formatSigned = (value) =>
  !Number.isFinite(value) || value === 0
    ? "±0"
    : `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))}`;

const formatDay = (timestamp) =>
  new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

const formatFullDay = (timestamp) =>
  new Date(timestamp).toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const toTimestamp = (recordedAt) =>
  new Date(String(recordedAt).replace(" ", "T")).getTime();

// Whole calendar days between two YYYY-MM-DD dates. Counting dates rather than
// subtracting timestamps keeps the answer independent of the clock time a
// snapshot happened to carry - the scheduled job does not land at the same
// minute every day.
const daysBetween = (from, to) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );

const asNumber = (value) => {
  const number = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  return Number.isFinite(number) ? number : null;
};

// Seasons are labelled S9, S10, S11 - compare the number, not the string, or
// S10 sorts before S9.
const seasonNumber = (season) => Number(String(season).replace(/\D/g, "")) || 0;

// The division whose band *starts* at this score, e.g. 40000 -> "Diamond 4".
// 50,000 opens nothing, so it answers with no name.
function leagueAtScore(score) {
  if (!Number.isFinite(score) || score < 0) return "";
  const index = Math.round(score / LEAGUE_STEP);
  if (index < 0 || index > TOP_INDEX) return "";
  const tier = LEAGUE_TIERS[Math.floor(index / 4)];
  return `${tier} ${4 - (index % 4)}`;
}

// The division a score *sits in*, e.g. 41000 -> "Diamond 4". Anything past the
// top band's ceiling still reads as Diamond 1, there being nothing above it.
function divisionOfScore(score) {
  if (!Number.isFinite(score) || score < 0) return "";
  const index = Math.min(Math.floor(score / LEAGUE_STEP), TOP_INDEX);
  const tier = LEAGUE_TIERS[Math.floor(index / 4)];
  if (!tier) return "";
  return `${tier} ${4 - (index % 4)}`;
}

// Tier hues are per family, not per division - Diamond 4 and Diamond 1 are the
// same colour, because the family is what the badge is naming.
function tierColor(league) {
  const family = String(league || "").split(" ")[0];
  return `var(${TIER_VARS[family] || "--text-muted"})`;
}

function cssValue(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function colorFor(player) {
  const index = Math.max(0, state.players.indexOf(player));
  const slots = CONFIG.seriesVars;
  return cssValue(slots[index % slots.length]);
}

function svgEl(tag, attributes = {}) {
  const node = document.createElementNS(CONFIG.svgNs, tag);
  Object.entries(attributes).forEach(([key, value]) =>
    node.setAttribute(key, String(value)),
  );
  return node;
}

/* --------------------------------------------------------------------------
   CSV
   -------------------------------------------------------------------------- */
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
    .map((header) => header.replace(/^﻿/, "").trim());
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
  const timestamp = toTimestamp(recordedAt);
  if (!Number.isFinite(timestamp)) return null;
  return {
    player,
    season,
    recordedAt,
    timestamp,
    date: recordedAt.split(/[ T]/)[0],
    score: asNumber(row.rankScore ?? row.score),
    rank: asNumber(row.rank),
    league: String(row.league || "").trim() || "Unranked",
  };
}

/* --------------------------------------------------------------------------
   Load
   -------------------------------------------------------------------------- */
async function loadData() {
  // Load both files together; rank data is required, while season metadata is
  // optional because the chart can still work from the records alone.
  try {
    const [rankResponse, seasonResponse] = await Promise.all([
      fetch(CONFIG.rankDataUrl),
      fetch(CONFIG.seasonsUrl),
    ]);
    if (!rankResponse.ok)
      throw new Error(`Rank data returned ${rankResponse.status}.`);
    const [rankText, seasonText] = await Promise.all([
      rankResponse.text(),
      seasonResponse.ok ? seasonResponse.text() : Promise.resolve(""),
    ]);

    state.records = parseCsv(rankText)
      .map(normalizeRecord)
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (!state.records.length)
      throw new Error("The rank CSV contains no usable records.");

    parseCsv(seasonText).forEach((row) => {
      if (row.season)
        state.seasons[String(row.season).toUpperCase()] = {
          start: row.startDate,
          end: row.endDate,
        };
    });

    // Colour follows the entity, so the slot order is a stable property of the
    // roster - not of whoever happens to be top of the ladder today.
    state.players = [
      ...new Set(state.records.map((record) => record.player)),
    ].sort((first, second) =>
      first.localeCompare(second, undefined, { sensitivity: "base" }),
    );

    state.seasonList = [
      ...new Set(state.records.map((record) => record.season)),
    ].sort((first, second) => seasonNumber(first) - seasonNumber(second));
    state.season = state.seasonList.at(-1);

    setStatus(`${formatNumber(state.records.length)} snapshots tracked`);
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
  $(".status-dot").classList.toggle("is-error", isError);
}

function populateSeasonSelect() {
  const select = $("#seasonSelect");
  select.replaceChildren(
    ...state.seasonList.map((season) => {
      const option = document.createElement("option");
      option.value = season;
      option.textContent = season;
      return option;
    }),
  );
  select.value = state.season;
  select.onchange = (event) => {
    state.season = event.target.value;
    render();
  };
}

/* --------------------------------------------------------------------------
   Selectors
   -------------------------------------------------------------------------- */
const seasonRecords = (season = state.season) =>
  state.records.filter((record) => record.season === season);

const playerRecords = (player, season = state.season) =>
  seasonRecords(season).filter((record) => record.player === player);

const hasMetric = (record) => Number.isFinite(record[state.metric]);

function seasonBests(player) {
  const history = playerRecords(player);
  const scored = history.filter((record) => Number.isFinite(record.score));
  return {
    latest: history.at(-1) || null,
    bestScore: scored.reduce(
      (best, record) => (!best || record.score > best.score ? record : best),
      null,
    ),
  };
}

/* --------------------------------------------------------------------------
   Chart model

   Two shapes feed the same renderer:
   - "roster"  one line per player across the selected season, x = date.
   - "player"  one line per season for a single player, x = days since that
               season's first snapshot, so seasons can be laid over each other.
   -------------------------------------------------------------------------- */
function buildModel() {
  return state.focused ? playerModel(state.focused) : rosterModel();
}

function rosterModel() {
  const series = state.players
    .filter((player) => playerRecords(player).some(hasMetric))
    .map((player) => ({
      id: player,
      label: player,
      color: colorFor(player),
      primary: true,
      points: withPrevious(
        playerRecords(player)
          .filter(hasMetric)
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((record) => ({
            key: record.date,
            x: record.timestamp,
            value: record[state.metric],
            record,
          })),
      ),
    }));
  return {
    mode: "roster",
    series,
    tickLabel: (bucket) => formatDay(bucket.x),
    bucketLabel: (bucket) => formatFullDay(bucket.x),
  };
}

function playerModel(player) {
  const dim = cssValue("--line-dim");
  const color = colorFor(player);
  const series = state.seasonList
    .filter((season) => playerRecords(player, season).some(hasMetric))
    .map((season) => {
      const records = playerRecords(player, season)
        .filter(hasMetric)
        .sort((a, b) => a.timestamp - b.timestamp);
      // Day 1 is the season's own opening day, not the day tracking happened to
      // start. S9 was only picked up three weeks in, so anchoring on its first
      // snapshot would draw those weeks as if they were the opening of the run
      // and leave the season ending three weeks before every other one. Against
      // the published start the run sits where it really fell: beginning late,
      // finishing level with the others. Seasons with no published start fall
      // back to their first snapshot.
      const opened = state.seasons[season]?.start || records[0].date;
      const primary = season === state.season;
      return {
        id: season,
        label: season,
        color: primary ? color : dim,
        primary,
        points: withPrevious(
          records.map((record) => {
            const day = daysBetween(opened, record.date);
            return {
              key: String(day),
              x: day,
              value: record[state.metric],
              record,
            };
          }),
        ),
      };
    });
  // The highlighted season is drawn last so it sits above the grey ones.
  series.sort((a, b) => Number(a.primary) - Number(b.primary));
  return {
    mode: "player",
    series,
    player,
    tickLabel: (bucket) => `Day ${bucket.x + 1}`,
    bucketLabel: (bucket) => `Day ${bucket.x + 1} of season`,
  };
}

function withPrevious(points) {
  points.forEach((point, index) => {
    point.previous = index > 0 ? points[index - 1] : null;
  });
  return points;
}

// One bucket per x position, holding whichever series report there. The
// crosshair snaps to buckets, so the reader aims at a date and every line
// answers at once.
function buildBuckets(series) {
  const map = new Map();
  series.forEach((entry) => {
    entry.points.forEach((point) => {
      if (!map.has(point.key))
        map.set(point.key, { key: point.key, x: point.x, entries: [] });
      map.get(point.key).entries.push({ series: entry, point });
    });
  });
  return [...map.values()].sort((a, b) => a.x - b.x);
}

/* --------------------------------------------------------------------------
   Scales
   -------------------------------------------------------------------------- */
// Score steps by exactly one league division; rank falls back to round numbers.
function scoreScale(min, max) {
  let low = Math.floor(min / LEAGUE_STEP) * LEAGUE_STEP;
  let high = Math.ceil(max / LEAGUE_STEP) * LEAGUE_STEP;
  if (high <= low) high = low + LEAGUE_STEP;
  // Two lines hugging the frame reads as an empty plot; open it up to three.
  while ((high - low) / LEAGUE_STEP < 2) {
    if (low - LEAGUE_STEP >= 0) low -= LEAGUE_STEP;
    else high += LEAGUE_STEP;
  }
  const ticks = [];
  for (let value = low; value <= high + 1e-6; value += LEAGUE_STEP)
    ticks.push(value);
  return { low, high, ticks };
}

function rankScale(min, max) {
  // Rank 1 is the best place there is, so the domain never opens below it and
  // no gridline is ever drawn at #0.
  let low = Math.max(1, Math.floor(min / RANK_STEP) * RANK_STEP);
  let high = Math.ceil(max / RANK_STEP) * RANK_STEP;
  if (high <= low) high = low + RANK_STEP;
  // When the domain starts at #1 that bound is itself worth a rule, because it
  // is the top of the ladder rather than an arbitrary edge.
  const ticksBetween = (from, to) => {
    const out = [];
    for (
      let value = Math.ceil(from / RANK_STEP) * RANK_STEP;
      value <= to + 1e-6;
      value += RANK_STEP
    )
      out.push(value);
    if (out[0] !== from) out.unshift(from);
    return out;
  };
  // Two lines hugging the frame reads as an empty plot; open it up to three.
  // Counting rules rather than the span matters here: a domain opening at #1
  // is always a place short of a whole number of steps.
  while (ticksBetween(low, high).length < 3) {
    if (low - RANK_STEP >= 1) low -= RANK_STEP;
    else high += RANK_STEP;
  }
  return { low, high, ticks: ticksBetween(low, high) };
}

/* --------------------------------------------------------------------------
   Chart
   -------------------------------------------------------------------------- */
function renderChart() {
  const svg = $("#rankChart");
  const wrap = svg.parentElement;
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;
  svg.replaceChildren();
  hideTooltip();
  state.hoverKey = null;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const model = buildModel();
  const buckets = buildBuckets(model.series);
  const values = model.series.flatMap((entry) =>
    entry.points.map((point) => point.value),
  );
  if (!buckets.length || !values.length) {
    $("#chartEmpty").hidden = false;
    svg.setAttribute("aria-label", "No data for the current selection.");
    state.plot = null;
    return;
  }
  $("#chartEmpty").hidden = true;

  const compact = width < 640;
  const overlaid = model.mode === "player";
  const pad = {
    top: 18,
    right: compact ? 16 : overlaid ? 46 : 126,
    bottom: 34,
    left: compact ? 56 : state.metric === "score" ? 82 : 64,
  };
  const plotWidth = Math.max(10, width - pad.left - pad.right);
  const plotHeight = Math.max(10, height - pad.top - pad.bottom);
  // Keep the extreme gridlines off the frame edge so a line never grazes it.
  const inset = 16;

  const scale =
    state.metric === "score"
      ? scoreScale(Math.min(...values), Math.max(...values))
      : rankScale(Math.min(...values), Math.max(...values));

  const xMin = buckets[0].x;
  const xSpan = buckets.at(-1).x - xMin || 1;
  const xFor = (x) => pad.left + (plotWidth * (x - xMin)) / xSpan;

  const ySpan = scale.high - scale.low || 1;
  const yTop = pad.top + inset;
  const yBottom = pad.top + plotHeight - inset;
  const yFor = (value) => {
    // Rank counts down: rank 1 is the best, so it belongs at the top.
    const ratio =
      state.metric === "rank"
        ? (value - scale.low) / ySpan
        : (scale.high - value) / ySpan;
    return yTop + (yBottom - yTop) * ratio;
  };

  const ink = {
    grid: cssValue("--grid"),
    band: cssValue("--band"),
    axis: cssValue("--axis"),
    muted: cssValue("--text-muted"),
    secondary: cssValue("--text-secondary"),
    primary: cssValue("--text-primary"),
    surface: cssValue("--surface"),
  };

  const defs = svgEl("defs");
  const gridGroup = svgEl("g");
  const seriesGroup = svgEl("g");
  const labelGroup = svgEl("g");
  const overlay = svgEl("g", { "pointer-events": "none" });

  // --- division bands -------------------------------------------------------
  // On the score axis consecutive gridlines are the floor and ceiling of one
  // league division, so tinting alternate gaps draws the actual ladder rungs
  // rather than decorative stripes. Rank has no such structure.
  if (state.metric === "score") {
    scale.ticks.forEach((value, index) => {
      if (index % 2 || index === scale.ticks.length - 1) return;
      const yA = yFor(value);
      const yB = yFor(scale.ticks[index + 1]);
      gridGroup.append(
        svgEl("rect", {
          x: pad.left,
          y: Math.min(yA, yB),
          width: plotWidth,
          height: Math.abs(yB - yA),
          fill: ink.band,
        }),
      );
    });
  }

  // --- horizontal rules -----------------------------------------------------
  scale.ticks.forEach((value) => {
    const y = yFor(value);
    gridGroup.append(
      svgEl("line", {
        x1: pad.left,
        x2: pad.left + plotWidth,
        y1: y,
        y2: y,
        stroke: ink.grid,
        "stroke-width": 1,
        "shape-rendering": "crispEdges",
      }),
    );
    const figure = svgEl("text", {
      x: pad.left - 14,
      y: y + (state.metric === "score" && !compact ? 0 : 4),
      fill: ink.secondary,
      "font-size": 12,
      "text-anchor": "end",
      "font-family": MONO,
      "font-variant-numeric": "tabular-nums",
    });
    figure.textContent =
      state.metric === "rank" ? formatRank(value) : formatNumber(value);
    gridGroup.append(figure);
    // On the score axis each 2,500 line is also a league boundary, so the
    // division it opens is named right under the figure.
    if (state.metric === "score" && !compact) {
      const tier = leagueAtScore(value);
      if (tier) {
        const name = svgEl("text", {
          x: pad.left - 14,
          y: y + 12,
          fill: ink.muted,
          "font-size": 9.5,
          "font-weight": 600,
          "text-anchor": "end",
          "letter-spacing": "0.1em",
        });
        name.textContent = tier;
        gridGroup.append(name);
      }
    }
  });

  // --- x labels -------------------------------------------------------------
  const tickTarget = Math.min(buckets.length, compact ? 3 : 6);
  const seen = new Set();
  for (let index = 0; index < tickTarget; index += 1) {
    const at =
      tickTarget === 1
        ? 0
        : Math.round((index * (buckets.length - 1)) / (tickTarget - 1));
    if (seen.has(at)) continue;
    seen.add(at);
    const bucket = buckets[at];
    const anchor =
      at === 0 ? "start" : at === buckets.length - 1 ? "end" : "middle";
    const label = svgEl("text", {
      x: xFor(bucket.x),
      y: pad.top + plotHeight + 20,
      fill: ink.muted,
      "font-size": 11,
      "font-family": MONO,
      "text-anchor": anchor,
    });
    label.textContent = model.tickLabel(bucket);
    gridGroup.append(label);
  }

  // --- lines ----------------------------------------------------------------
  const ends = [];
  model.series.forEach((entry) => {
    const coords = entry.points.map((point) => ({
      x: xFor(point.x),
      y: yFor(point.value),
      point,
    }));
    if (!coords.length) return;
    const path = coords
      .map((coord) => `${coord.x.toFixed(1)},${coord.y.toFixed(1)}`)
      .join(" ");

    // A single highlighted line gets a soft wash beneath it; with several
    // lines overlapping, fills would just muddy each other.
    if (entry.primary && model.mode === "player") {
      const gradientId = "wash";
      const gradient = svgEl("linearGradient", {
        id: gradientId,
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 1,
      });
      gradient.append(
        svgEl("stop", {
          offset: "0%",
          "stop-color": entry.color,
          "stop-opacity": 0.14,
        }),
        svgEl("stop", {
          offset: "100%",
          "stop-color": entry.color,
          "stop-opacity": 0,
        }),
      );
      defs.append(gradient);
      const base = pad.top + plotHeight;
      seriesGroup.append(
        svgEl("polygon", {
          points: `${coords[0].x.toFixed(1)},${base} ${path} ${coords
            .at(-1)
            .x.toFixed(1)},${base}`,
          fill: `url(#${gradientId})`,
        }),
      );
    }

    seriesGroup.append(
      svgEl("polyline", {
        // Straight segments only - no curve smoothing, so every plotted value
        // sits exactly where the data puts it.
        points: path,
        fill: "none",
        stroke: entry.color,
        "stroke-width": entry.primary ? 2.4 : 1.6,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
        opacity: entry.primary ? 1 : 0.85,
      }),
    );

    // One marker only, at the latest value - no dot per snapshot. A soft halo
    // sits under it so the line's endpoint reads as the live value.
    const last = coords.at(-1);
    seriesGroup.append(
      svgEl("circle", {
        cx: last.x,
        cy: last.y,
        r: entry.primary ? 8 : 6,
        fill: entry.color,
        opacity: entry.primary ? 0.2 : 0.14,
      }),
    );
    seriesGroup.append(
      svgEl("circle", {
        cx: last.x,
        cy: last.y,
        r: entry.primary ? 3.5 : 2.5,
        fill: entry.color,
        stroke: ink.surface,
        "stroke-width": 2,
      }),
    );
    ends.push({ entry, x: last.x, y: last.y, value: last.point.value });
  });

  // --- direct end labels ----------------------------------------------------
  // Seasons run to different lengths, so in the overlay each tag sits at its
  // own line end. A leader running out to a shared gutter would draw a long
  // diagonal from where a short season stopped to the right edge, which reads
  // as the line continuing rather than as the season having ended.
  if (!compact && ends.length && overlaid) {
    const ordered = [...ends].sort((a, b) => a.y - b.y);
    ordered.forEach((end, index) => {
      end.labelY = end.y + 4;
      const above = ordered[index - 1];
      // Only push apart tags that are also horizontally close, or a tag gets
      // shoved away from the line it belongs to.
      if (above && Math.abs(above.x - end.x) < 56)
        end.labelY = Math.max(end.labelY, above.labelY + 14);
    });
    ordered.forEach((end) => {
      const tag = svgEl("text", {
        x: end.x + 9,
        y: end.labelY,
        fill: end.entry.primary ? ink.primary : ink.muted,
        "font-size": 11,
        "font-weight": end.entry.primary ? 600 : 500,
        "font-variant-numeric": "tabular-nums",
      });
      tag.textContent = end.entry.label;
      labelGroup.append(tag);
    });
  } else if (!compact && ends.length) {
    // One line per tag - name then value - rather than a name stacked over its
    // figure. It halves the vertical room a tag needs, so ends that sit close
    // together no longer have to be pushed apart, and the connector stays a
    // short straight rule instead of a slant.
    const gap = 16;
    const ordered = [...ends].sort((a, b) => a.y - b.y);
    ordered.forEach((end, index) => {
      end.labelY = end.y;
      if (index > 0) {
        const floorY = ordered[index - 1].labelY + gap;
        end.labelY = Math.max(end.labelY, floorY);
      }
    });
    const spill = ordered.at(-1).labelY - (pad.top + plotHeight);
    if (spill > 0) ordered.forEach((end) => (end.labelY -= spill));

    const labelX = pad.left + plotWidth + 18;
    ordered.forEach((end) => {
      labelGroup.append(
        svgEl("line", {
          x1: end.x + 5,
          y1: end.y,
          x2: labelX - 5,
          y2: end.labelY,
          stroke: end.entry.color,
          "stroke-width": 1,
          opacity: end.entry.primary ? 0.55 : 0.4,
        }),
      );
      const tag = svgEl("text", {
        x: labelX,
        y: end.labelY + 4,
        fill: end.entry.primary ? ink.primary : ink.muted,
        "font-size": end.entry.primary ? 12 : 11,
        "font-weight": end.entry.primary ? 600 : 500,
      });
      const who = svgEl("tspan");
      who.textContent = end.entry.label;
      const figure = svgEl("tspan", {
        dx: 6,
        fill: ink.muted,
        "font-size": 10.5,
        "font-weight": 500,
        "font-family": MONO,
        "font-variant-numeric": "tabular-nums",
      });
      figure.textContent =
        state.metric === "rank"
          ? formatRank(end.value)
          : formatNumber(end.value);
      tag.append(who, figure);
      labelGroup.append(tag);
    });
  }

  svg.append(defs, gridGroup, seriesGroup, labelGroup, overlay);
  const measure = state.metric === "rank" ? "Leaderboard rank" : "Rank score";
  const who =
    model.mode === "player"
      ? `${model.player} across ${model.series.map((s) => s.label).join(", ")}`
      : `${model.series.map((s) => s.label).join(", ")} in ${state.season}`;
  svg.setAttribute(
    "aria-label",
    `${measure} for ${who}. ` +
      "Full values are in the table view below.",
  );

  state.plot = { model, buckets, xFor, yFor, pad, plotHeight, ink };
  attachInteraction(svg);
}

/* --------------------------------------------------------------------------
   Hover & keyboard readout
   -------------------------------------------------------------------------- */
function attachInteraction(svg) {
  svg.onpointermove = (event) => {
    if (!state.plot) return;
    const bounds = svg.getBoundingClientRect();
    showBucket(nearestBucket(event.clientX - bounds.left));
  };
  svg.onpointerleave = () => showBucket(-1);
  svg.onblur = () => showBucket(-1);
  svg.onkeydown = (event) => {
    if (!state.plot) return;
    const { buckets } = state.plot;
    if (event.key === "Escape") return showBucket(-1);
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const current = buckets.findIndex((b) => b.key === state.hoverKey);
    const edge = step > 0 ? -1 : buckets.length;
    const start = current < 0 ? edge : current;
    showBucket(Math.min(Math.max(start + step, 0), buckets.length - 1));
  };
}

function nearestBucket(pointerX) {
  const { buckets, xFor } = state.plot;
  let bestIndex = -1;
  let bestDistance = Infinity;
  buckets.forEach((bucket, index) => {
    const distance = Math.abs(xFor(bucket.x) - pointerX);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function showBucket(index) {
  const svg = $("#rankChart");
  const overlay = svg.lastElementChild;
  if (!overlay || !state.plot) return;
  overlay.replaceChildren();
  if (index < 0) {
    state.hoverKey = null;
    return hideTooltip();
  }

  const { buckets, xFor, yFor, pad, plotHeight, ink } = state.plot;
  const bucket = buckets[index];
  state.hoverKey = bucket.key;
  const x = xFor(bucket.x);

  overlay.append(
    svgEl("line", {
      x1: x,
      x2: x,
      y1: pad.top,
      y2: pad.top + plotHeight,
      stroke: ink.axis,
      "stroke-width": 1,
      "shape-rendering": "crispEdges",
    }),
  );

  const rows = [...bucket.entries].map(({ series, point }) => {
    const y = yFor(point.value);
    overlay.append(
      svgEl("circle", {
        cx: x,
        cy: y,
        r: 4.5,
        fill: series.color,
        stroke: ink.surface,
        "stroke-width": 2,
      }),
    );
    return { series, point, y };
  });
  if (!rows.length) return hideTooltip();
  rows.sort((a, b) => a.y - b.y);
  showTooltip(bucket, rows, x);
}

function showTooltip(bucket, rows, x) {
  const tooltip = $("#chartTooltip");
  const wrap = tooltip.parentElement;
  tooltip.replaceChildren();

  const heading = document.createElement("div");
  heading.className = "tooltip-date";
  heading.textContent = state.plot.model.bucketLabel(bucket);
  tooltip.append(heading);

  rows.forEach(({ series, point }) => {
    const row = document.createElement("div");
    row.className = "tooltip-row";

    const key = document.createElement("span");
    key.className = "tooltip-key";
    key.style.background = series.color;

    const name = document.createElement("span");
    name.className = "tooltip-name";
    name.textContent = series.label;

    const value = document.createElement("span");
    value.className = "tooltip-value";
    value.textContent =
      state.metric === "rank"
        ? formatRank(point.record.rank)
        : formatNumber(point.record.score);

    row.append(key, name, value);

    if (point.previous) {
      // On the rank view a smaller number is a better place, so the sign is
      // flipped to keep "up" meaning "climbed".
      const change =
        state.metric === "rank"
          ? point.previous.value - point.value
          : point.value - point.previous.value;
      if (Number.isFinite(change)) {
        const delta = document.createElement("span");
        const direction = change > 0 ? " is-up" : change < 0 ? " is-down" : "";
        delta.className = `tooltip-delta${direction}`;
        delta.textContent = formatSigned(change);
        row.append(delta);
      }
    }
    tooltip.append(row);
  });

  tooltip.hidden = false;
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  const left = Math.min(
    Math.max(x - width / 2, 4),
    Math.max(4, wrap.clientWidth - width - 4),
  );
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(4, rows[0].y - height - 14)}px`;
}

function hideTooltip() {
  const tooltip = $("#chartTooltip");
  if (tooltip) tooltip.hidden = true;
}

/* --------------------------------------------------------------------------
   Page chrome
   -------------------------------------------------------------------------- */
function render() {
  renderSeasonRun();
  renderHeadings();
  renderLegend();
  renderChart();
  renderLivePanel();
  renderPlayerCards();
  renderTable();
  const newest = state.records.at(-1);
  $("#lastUpdated").textContent = newest
    ? `Last update: ${new Date(newest.timestamp).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })}`
    : "Last update: --";
}

// Seasons run to a published end date, so "day 79 of 91" is a fact the data
// already carries. The bar is that fact, not an ornament.
function renderSeasonRun() {
  const meta = state.seasons[state.season];
  const records = seasonRecords();
  const run = $("#seasonRun");
  run.hidden = !records.length;
  if (!records.length) return;

  const span = `${formatFullDay(records[0].timestamp)} – ${formatFullDay(
    records.at(-1).timestamp,
  )}`;
  $("#seasonRange").textContent =
    `Tracked ${span} · ${formatNumber(records.length)} snapshots`;

  const start = meta ? toTimestamp(meta.start) : NaN;
  const end = meta ? toTimestamp(meta.end) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    $("#runDay").textContent = state.season;
    $("#runEnd").textContent = "";
    $("#runFill").style.width = "0%";
    $("#runTrack").removeAttribute("aria-valuenow");
    return;
  }

  const total = Math.max(1, Math.round((end - start) / DAY_MS));
  const elapsed = Math.min(
    total,
    Math.max(0, Math.round((Date.now() - start) / DAY_MS)),
  );
  const percent = Math.round((elapsed / total) * 100);
  $("#runDay").textContent =
    `${state.season} · day ${Math.min(elapsed + 1, total)} of ${total}`;
  $("#runEnd").textContent = `Ends ${formatFullDay(end)}`;
  $("#runFill").style.width = `${percent}%`;
  $("#runTrack").setAttribute("aria-valuenow", String(percent));
}

function renderHeadings() {
  const focused = state.focused;
  const measure = state.metric === "score" ? "Rank score" : "Leaderboard rank";

  $("#chartEyebrow").textContent = focused
    ? "All seasons overlaid"
    : `Season ${state.season}`;
  $("#chartTitle").textContent = focused || "Ranked cashout";

  // A colour bar on the eyebrow ties the header to the highlighted line.
  document.documentElement.style.setProperty(
    "--eyebrow-accent",
    focused ? colorFor(focused) : cssValue("--accent"),
  );

  const chips = [measure];
  if (focused) {
    const seasons = state.seasonList.filter(
      (season) => playerRecords(focused, season).length,
    ).length;
    chips.push(`${seasons} seasons`, `${state.season} highlighted`);
  }
  $("#chartMeta").replaceChildren(
    ...chips.map((text, index) => {
      const chip = document.createElement("span");
      chip.className = index === 0 ? "meta-chip is-lead" : "meta-chip";
      chip.textContent = text;
      return chip;
    }),
  );

  $("#clearFocus").hidden = !focused;
}

function renderLegend() {
  const legend = $("#chartLegend");
  if (state.focused) {
    // In the season overlay the series are seasons, not players, so the
    // legend is identity only - the season filter above still drives which
    // one is highlighted.
    const model = playerModel(state.focused);
    legend.replaceChildren(
      ...model.series
        .slice()
        .sort((a, b) => seasonNumber(a.label) - seasonNumber(b.label))
        .map((entry) => {
          const item = document.createElement("span");
          item.className = entry.primary
            ? "legend-item is-primary"
            : "legend-item";
          const key = document.createElement("span");
          key.className = "legend-key";
          key.style.background = entry.color;
          const name = document.createElement("span");
          name.textContent = entry.label;
          item.append(key, name);
          return item;
        }),
    );
    return;
  }
  // Only players who actually reported in this season get a key, and the key
  // opens that player's season overlay - it is not a visibility toggle.
  const roster = state.players.filter((player) => playerRecords(player).length);
  legend.replaceChildren(
    ...roster.map((player) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "legend-button";
      button.style.color = colorFor(player);
      button.setAttribute("aria-label", `Show every season for ${player}`);
      const key = document.createElement("span");
      key.className = "legend-key";
      const name = document.createElement("span");
      name.style.color = "var(--text-primary)";
      name.textContent = player;
      button.append(key, name);
      button.onclick = () => setFocus(player);
      return button;
    }),
  );
}

function setFocus(player) {
  state.focused = state.focused === player ? "" : player;
  renderHeadings();
  renderLegend();
  renderChart();
  renderLivePanel();
  renderPlayerCards();
}

/* --------------------------------------------------------------------------
   Live standings - who is where right now, ordered by score
   -------------------------------------------------------------------------- */
function renderLivePanel() {
  const rows = state.players
    .map((player) => ({ player, record: playerRecords(player).at(-1) }))
    .filter((row) => row.record)
    .sort((first, second) => {
      const a = Number.isFinite(first.record.score) ? first.record.score : -1;
      const b = Number.isFinite(second.record.score) ? second.record.score : -1;
      return b - a;
    });

  $("#liveSeason").textContent = state.season;
  const newest = seasonRecords().at(-1);
  // The feed is a daily job, so name the snapshot rather than implying a
  // second-by-second ticker.
  $("#liveStamp").textContent = newest
    ? `Latest snapshot ${new Date(newest.timestamp).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })}`
    : "Waiting for data";

  const list = $("#liveList");
  list.replaceChildren(
    ...rows.map((row) => buildLiveRow(row.player)),
  );
}

// Two lines per player: who scored what, then which division that score sits
// in, their leaderboard place and the move since the last snapshot.
function buildLiveRow(player) {
  const history = playerRecords(player);
  const record = history.at(-1);
  const previous = history.at(-2);
  const division = divisionOfScore(record.score);

  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "live-row";
  button.setAttribute("aria-label", `Show every season for ${player}`);

  const name = document.createElement("span");
  name.className = "live-name";
  name.textContent = player;

  const score = document.createElement("span");
  score.className = "live-score";
  score.textContent = formatNumber(record.score);

  // Division and leaderboard place share the last line: both are "where they
  // stand", and neither is the headline the score is.
  const tier = document.createElement("span");
  tier.className = "live-tier";
  const tierName = document.createElement("span");
  tierName.textContent = division || record.league || "Unranked";
  const rank = document.createElement("span");
  rank.className = "live-rank";
  rank.textContent = formatRank(record.rank);
  tier.append(tierName, rank);

  const delta = document.createElement("span");
  delta.className = "live-delta";
  const change =
    Number.isFinite(record.score) && Number.isFinite(previous?.score)
      ? record.score - previous.score
      : null;
  if (change === null) {
    delta.textContent = "First snapshot";
  } else {
    // classList.add throws on an empty token, so a flat day gets no class.
    if (change !== 0) delta.classList.add(change > 0 ? "is-up" : "is-down");
    const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "±";
    delta.textContent = `${arrow} ${formatNumber(Math.abs(change))}`;
  }
  button.append(name, score, tier, delta);
  button.onclick = () => setFocus(player);
  item.append(button);
  return item;
}

/* --------------------------------------------------------------------------
   Season bests
   -------------------------------------------------------------------------- */
function renderPlayerCards() {
  $("#bestsSeason").textContent = state.season;
  const players = state.players.filter(
    (player) => playerRecords(player).length,
  );
  const list = $("#bestsList");
  if (!players.length) {
    const empty = document.createElement("li");
    empty.className = "bests-date";
    empty.textContent = "No players reported in this season.";
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...players.map(buildBestsRow));
}

function buildBestsRow(player) {
  const { latest, bestScore } = seasonBests(player);

  const item = document.createElement("li");
  const row = document.createElement("button");
  row.type = "button";
  row.className = "bests-row";
  if (state.focused === player) row.classList.add("is-selected");
  if (state.focused && state.focused !== player)
    row.classList.add("is-dimmed");
  row.style.setProperty("--player-color", colorFor(player));
  row.setAttribute("aria-label", `Show every season for ${player}`);

  const who = document.createElement("span");
  who.className = "bests-who";
  const key = document.createElement("span");
  key.className = "bests-key";
  const name = document.createElement("span");
  name.className = "bests-name";
  name.textContent = player;
  who.append(key, name);

  const score = document.createElement("span");
  score.className = "bests-cell";
  score.textContent = formatNumber(bestScore?.score);

  const league = document.createElement("span");
  league.className = "bests-league";
  league.textContent = latest?.league || "Unranked";
  league.style.setProperty("--tier", tierColor(latest?.league));

  const scoreDate = document.createElement("span");
  scoreDate.className = "bests-date";
  scoreDate.textContent = bestScore ? formatDay(bestScore.timestamp) : "";

  row.append(who, score, league, scoreDate);
  row.onclick = () => setFocus(player);
  item.append(row);
  return item;
}

/* --------------------------------------------------------------------------
   Table view - the tooltip never gates a value
   -------------------------------------------------------------------------- */
function renderTable() {
  const body = $("#dataTableBody");
  const rows = [...seasonRecords()]
    .sort(
      (a, b) => b.timestamp - a.timestamp || a.player.localeCompare(b.player),
    )
    .map((record) => {
      const tr = document.createElement("tr");
      tr.append(
        cell(formatFullDay(record.timestamp)),
        playerCell(record.player),
        cell(record.league),
        cell(formatRank(record.rank), "numeric"),
        cell(formatNumber(record.score), "numeric"),
      );
      return tr;
    });
  body.replaceChildren(...rows);
}

function cell(text, className = "") {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

function playerCell(player) {
  const td = document.createElement("td");
  const key = document.createElement("span");
  key.className = "table-key";
  key.style.background = colorFor(player);
  td.append(key, document.createTextNode(player));
  return td;
}

/* --------------------------------------------------------------------------
   Theme
   -------------------------------------------------------------------------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = $("#themeToggle");
  toggle.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  );
  try {
    localStorage.setItem(CONFIG.themeKey, theme);
  } catch (error) {
    // Private windows and blocked site data are fine - the theme simply
    // resets to the dark default on the next visit.
  }
}

$("#themeToggle").onclick = () => {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  // Series hues and chart ink are CSS tokens, so everything colour-bearing is
  // redrawn to pick up the mode's own validated steps.
  if (state.records.length) {
    renderLegend();
    renderChart();
    renderLivePanel();
    renderPlayerCards();
    renderTable();
  }
};
applyTheme(
  document.documentElement.dataset.theme === "light" ? "light" : "dark",
);

/* --------------------------------------------------------------------------
   Events
   -------------------------------------------------------------------------- */
$("#clearFocus").onclick = () => setFocus(state.focused);

document.querySelectorAll(".metric-button").forEach((button) => {
  button.onclick = () => {
    state.metric = button.dataset.metric;
    document.querySelectorAll(".metric-button").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderHeadings();
    renderChart();
  };
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (state.records.length) renderChart();
  }, 120);
});

loadData();
