// ============ Configuration ============
const CONFIG = {
    //csvUrl: '../data/rank_data.csv',
    //seasonsUrl: '../data/seasons.csv',
    csvUrl: 'data/rank_data.csv',
    seasonsUrl: 'data/seasons.csv',
    playerColors: ['#FA00FF', '#FF7B00', '#05FF00'],
    views: {
        score: {
            label: 'Rank Score',
            stepSize: 2500,
            reverse: false
        },
        rank: {
            label: 'Leaderboard Rank',
            stepSize: 500,
            reverse: true
        }
    },
    chart: {
        defaultColor: '#a0a0a0',
        defaultBorderColor: '#1a4875',
        gridColor: '#1a4875',
        tooltipBg: '#080224',
        tooltipBorder: '#15D1FF'
    },
    dataset: {
        borderWidth: 2,
        pointRadius: 1,
        pointHoverRadius: 5,
        pointHitRadius: 8
    }
};

// ============ State ============
let chartInstance = null;
let chartData = { labels: [], datasets: [] };
let currentView = 'score';
let fullData = [];
let currentSeason = null;
let soloPlayer = null; // steamName of the currently isolated player, or null
let seasonsMap = {}; // e.g. { S9: { startDate: '2025-12-10', endDate: '2026-03-18' } }

// ============ Utilities ============
const getDayInSeason = (timestamp, season) => {
    const info = seasonsMap[season ? season.toUpperCase() : ''];
    if (!info) return timestamp.split(' ')[0];
    const start = new Date(info.startDate);
    const date = new Date(timestamp.split(' ')[0]);
    return Math.floor((date - start) / 86400000);
};

// Returns the nearest previous season key that has ranked data for the player, or null.
const getPrevSeasonKey = (season, playerName) => {
    const sorted = Object.keys(seasonsMap).sort((a, b) => {
        return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10);
    });
    const idx = sorted.indexOf(season.toUpperCase());
    if (idx <= 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
        const candidate = sorted[i];
        const hasData = fullData.some(
            item => item.season === candidate && item.steamName === playerName
        );
        if (hasData) return candidate;
    }
    return null;
};

const createDataset = (player, data, color, isPrevSeason = false) => ({
    label: isPrevSeason ? `${player} (prev)` : player,
    data,
    borderColor: isPrevSeason ? color + '60' : color,
    backgroundColor: 'transparent',
    pointBackgroundColor: isPrevSeason ? color + '60' : color,
    pointBorderColor: isPrevSeason ? color + '60' : color,
    borderWidth: isPrevSeason ? 1.5 : CONFIG.dataset.borderWidth,
    borderDash: isPrevSeason ? [1, 1] : [],
    pointRadius: CONFIG.dataset.pointRadius,
    pointHoverRadius: isPrevSeason ? 3 : CONFIG.dataset.pointHoverRadius,
    pointHitRadius: isPrevSeason ? 4 : CONFIG.dataset.pointHitRadius,
    fill: false,
    pointStyle: 'circle',
    tension: 0,
    isPrevSeason,
    parsing: { yAxisKey: currentView },
    order: 1
});

// ============ Delta Label Plugin ============
const deltaLabelPlugin = {
    id: 'deltaLabel',
    afterDatasetsDraw(chart) {
        const { ctx, scales: { x, y } } = chart;
        const yKey = currentView;

        chart.data.datasets.forEach((dataset, i) => {
            if (!chart.isDatasetVisible(i)) return;
            if (dataset.isPrevSeason) return; // skip prev-season lines

            const points = dataset.data;
            if (!points || points.length < 2) return;

            const last = points[points.length - 1];
            const prev = points[points.length - 2];

            const lastVal = last[yKey];
            const prevVal = prev[yKey];
            if (lastVal == null || prevVal == null) return;

            const delta = lastVal - prevVal;
            if (delta === 0) return;

            const displayDelta = yKey === 'rank' ? -delta : delta;
            const sign = displayDelta > 0 ? '+' : '';
            const label = `${sign}${displayDelta.toLocaleString()}`;

            const xPx = x.getPixelForValue(last.x) + 8;
            const yPx = y.getPixelForValue(lastVal);

            ctx.save();
            ctx.font = `bold ${window.innerWidth < 600 ? '9px' : '11px'} "Segoe UI", Roboto, Arial, sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';

            const isImprovement = displayDelta > 0;
            ctx.fillStyle = isImprovement ? '#0084FF' : '#FF4315';

            ctx.fillText(label, xPx, yPx);
            ctx.restore();
        });
    }
};

// ============ Loading Indicator ============
function showLoading(visible) {
    let indicator = document.getElementById('loadingIndicator');
    if (!indicator) return;
    indicator.style.display = visible ? 'flex' : 'none';
}

// ============ Data Processing ============
async function fetchData() {
    showLoading(true);
    try {
        const [rankResponse, seasonsResponse] = await Promise.all([
            fetch(CONFIG.csvUrl),
            fetch(CONFIG.seasonsUrl)
        ]);
        const [rankCsv, seasonsCsv] = await Promise.all([
            rankResponse.text(),
            seasonsResponse.text()
        ]);

        Papa.parse(seasonsCsv, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                results.data.forEach(row => {
                    if (row.season) {
                        seasonsMap[row.season.toUpperCase()] = {
                            startDate: row.startDate,
                            endDate: row.endDate
                        };
                    }
                });
            }
        });

        Papa.parse(rankCsv, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => {
                processData(results.data);
                showLoading(false);
            }
        });
    } catch (error) {
        console.error("Error loading CSV:", error);
        showLoading(false);
    }
}

function processData(data) {
    if (!data || !Array.isArray(data)) return;

    const cleanData = data
        .filter(row => row.recordedAt && row.steamName)
        .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

    fullData = cleanData.map(item => ({
        ...item,
        season: item.season ? String(item.season).toUpperCase() : item.season
    }));

    const seasons = [...new Set(fullData.map(item => item.season))].filter(s => s !== undefined && s !== null);
    populateSeasonOptions(seasons);

    currentSeason = seasons[seasons.length - 1];
    buildChartDataForSeason(currentSeason);
}

function populateSeasonOptions(seasons) {
    const select = document.getElementById('seasonSelect');
    if (!select) return;
    select.innerHTML = '';

    seasons.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        select.appendChild(opt);
    });

    select.value = seasons[seasons.length - 1];
    select.addEventListener('change', (e) => updateSeasonSelect(e.target.value));
}

// Build player data points for a given season, mapped onto that season's day axis
function buildPlayerData(playerName, season) {
    return fullData
        .filter(item => item.season === season && item.steamName === playerName)
        .map(item => ({
            x: getDayInSeason(item.recordedAt, season),
            score: item.rankScore,
            rank: item.rank,
            league: item.league,
            season: item.season,
            date: item.recordedAt.split(' ')[0]
        }));
}

function getViewBounds() {
    if (fullData.length === 0) {
        return {
            score: { yMin: 20000, yMax: 50000 },
            rank: { yMin: 1, yMax: 10000 }
        };
    }

    const scores = fullData.map(d => d.rankScore);
    const rawMinScore = Math.min(...scores);
    const rawMaxScore = Math.max(...scores);

    const globalScoreMin = Math.floor(rawMinScore / 2500) * 2500;
    const globalScoreMax = Math.ceil((Math.max(rawMaxScore, 40000) + 500) / 2500) * 2500;

    const ranks = fullData.map(d => d.rank).filter(r => r > 0);
    const globalRankMin = 0;
    const rawMaxRank = Math.max(...ranks);
    const globalRankMax = Math.ceil(rawMaxRank / 500) * 500;

    return {
        score: {
            yMin: globalScoreMin,
            yMax: globalScoreMax
        },
        rank: {
            yMin: globalRankMin,
            yMax: globalRankMax
        }
    };
}

function buildChartDataForSeason(season) {
    soloPlayer = null; // reset isolation on season change
    const filtered = fullData.filter(item => item.season === season);

    const daySet = new Set(filtered.map(item => getDayInSeason(item.recordedAt, item.season)));
    chartData.labels = [1, ...[...daySet].filter(d => d !== 1)].sort((a, b) => a - b);

    const groupedByPlayer = filtered.reduce((acc, item) => {
        const playerName = item.steamName;
        if (!acc[playerName]) acc[playerName] = [];
        acc[playerName].push({
            x: getDayInSeason(item.recordedAt, item.season),
            score: item.rankScore,
            rank: item.rank,
            league: item.league,
            season: item.season,
            date: item.recordedAt.split(' ')[0]
        });
        return acc;
    }, {});

    chartData.datasets = Object.entries(groupedByPlayer).map(([player, playerData], index) => {
        const color = CONFIG.playerColors[index % CONFIG.playerColors.length];
        return createDataset(player, playerData, color);
    });

    renderChart();
}

function syncPrevSeasonDataset() {
    if (!chartInstance) return;

    chartInstance.data.datasets = chartInstance.data.datasets.filter(ds => !ds.isPrevSeason);

    if (!soloPlayer) {
        chartInstance.options = getChartOptions();
        chartInstance.update();
        return;
    }

    const prevSeason = getPrevSeasonKey(currentSeason, soloPlayer);
    if (!prevSeason) {
        chartInstance.options = getChartOptions();
        chartInstance.update();
        return;
    }

    const prevData = buildPlayerData(soloPlayer, prevSeason);
    if (!prevData.length) {
        chartInstance.options = getChartOptions();
        chartInstance.update();
        return;
    }

    const currentDs = chartInstance.data.datasets.find(ds => ds.label === soloPlayer);
    const color = currentDs ? currentDs.borderColor : '#ffffff';

    chartInstance.data.datasets.push(createDataset(soloPlayer, prevData, color, true));

    chartInstance.options = getChartOptions(prevData);
    chartInstance.update(); // Removed 'none'
}

// ============ Chart Annotations ============
function getAnnotations(view) {
    const annotations = {
        score: {
            diamondZone: {
                type: 'box',
                yScaleID: 'y',
                yMin: (ctx) => 40000,
                backgroundColor: 'rgba(0, 251, 255, 0.1)',
                borderColor: 'transparent'
            },
            diamondLine: {
                type: 'line',
                yScaleID: 'y',
                yMin: (ctx) => 40000,
                yMax: (ctx) => 40000,
                borderColor: 'rgba(0, 251, 255, 0.6)',
                borderWidth: 3,
                drawTime: 'beforeDatasetsDraw'
            }
        },
        rank: {
            top500Zone: {
                type: 'box',
                yScaleID: 'y',
                yMin: (ctx) => 1,
                yMax: (ctx) => 500,
                backgroundColor: 'rgba(255, 0, 0, 0.1)',
                borderColor: 'transparent',
                drawTime: 'beforeDatasetsDraw'
            },
            top500Line: {
                type: 'line',
                yScaleID: 'y',
                yMin: (ctx) => 500,
                yMax: (ctx) => 500,
                borderColor: 'rgba(255, 0, 0, 0.6)',
                borderWidth: 3
            }
        }
    };
    return annotations[view];
}

// ============ Chart Rendering ============
function getChartOptions(extraPoints = []) {
    const bounds = getViewBounds(currentSeason, extraPoints);
    const viewCfg = CONFIG.views[currentView];

    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 150 },
        layout: {
            padding: { right: window.innerWidth < 600 ? 30 : 50 }
        },
        plugins: {
            annotation: { annotations: getAnnotations(currentView) },
            legend: {
                position: 'top',
                align: 'center',
                labels: {
                    color: '#ffffff',
                    font: { weight: 'bold' },
                    usePointStyle: true,
                    padding: 15,
                    boxWidth: 6,
                    boxHeight: 6,
                    generateLabels: (chart) => {
                        // Only show non-prev-season datasets in the legend
                        return chart.data.datasets
                            .map((dataset, i) => ({ dataset, i }))
                            .filter(({ dataset }) => !dataset.isPrevSeason)
                            .map(({ dataset, i }) => {
                                const hidden = !chart.isDatasetVisible(i);
                                const color = dataset.borderColor;
                                return {
                                    text: dataset.label,
                                    fillStyle: hidden ? '#555' : color,
                                    strokeStyle: hidden ? '#555' : color,
                                    fontColor: hidden ? '#666' : '#ffffff',
                                    hidden: false,
                                    datasetIndex: i,
                                    pointStyle: 'circle',
                                    lineWidth: 0
                                };
                            });
                    }
                },
                onClick: (e, legendItem, legend) => {
                    const index = legendItem.datasetIndex;
                    const ci = legend.chart;
                    const clickedPlayer = ci.data.datasets[index]?.label;

                    // Check if this player is already the only one visible (solo state)
                    const onlyThisVisible = ci.data.datasets.every((ds, i) => {
                        if (ds.isPrevSeason) return true; // ignore prev-season in check
                        return i === index ? ci.isDatasetVisible(i) : !ci.isDatasetVisible(i);
                    });

                    if (onlyThisVisible) {
                        // Clicking the solo player again → restore all
                        soloPlayer = null;
                        ci.data.datasets.forEach((ds, i) => {
                            if (!ds.isPrevSeason) ci.show(i);
                        });
                    } else {
                        // Solo this player
                        soloPlayer = clickedPlayer;
                        ci.data.datasets.forEach((ds, i) => {
                            if (ds.isPrevSeason) return;
                            i === index ? ci.show(i) : ci.hide(i);
                        });
                    }

                    syncPrevSeasonDataset();
                }
            },
            tooltip: {
                backgroundColor: CONFIG.chart.tooltipBg,
                titleColor: '#fff',
                bodyColor: '#fff',
                padding: 10,
                borderColor: CONFIG.chart.tooltipBorder,
                borderWidth: 1,
                boxWidth: 6,
                boxHeight: 6,
                cornerRadius: 0,
                usePointStyle: true,
                displayColors: false,
                callbacks: {
                    title: (items) => {
                        const day = items[0]?.label;
                        return `Day ${day}`;
                    },
                    label: (context) => {
                        const { score, rank, league, season, date } = context.raw;
                        const lines = [
                            `Player: ${context.dataset.label}`,
                            `Season: ${season}`,
                            `Date: ${date}`,
                            `Score: ${score ? score.toLocaleString() : 'N/A'}`,
                            `League: ${league}`
                        ];
                        if (rank != null) lines.splice(4, 0, `Rank: ${rank.toLocaleString()}`);
                        return lines;
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'linear',
                offset: true,
                grid: { display: false },
                min: 1,
                title: {
                    display: false,
                    text: `Day of ${currentSeason}`,
                    color: '#fff'
                },
                ticks: {
                    maxTicksLimit: 10,
                    precision: 0,
                    callback: (val) => `Day ${val}`
                }
            },
            y: {
                reverse: viewCfg.reverse,
                title: { display: true, text: CONFIG.views[currentView].label, color: '#fff' },
                grid: { color: CONFIG.chart.gridColor },
                min: bounds[currentView].yMin,
                max: bounds[currentView].yMax,
                suggestedMax: bounds[currentView].yMax,
                ticks: {
                    stepSize: CONFIG.views[currentView].stepSize,
                    precision: 0,
                    callback: function(value) {
                        if (currentView === 'rank' && value === 0) {
                            return 1;
                        }
                        return value;
                    }
                },
                afterFit: (axis) => { axis.width = window.innerWidth < 600 ? 70 : 80; }
            }
        }
    };
}

function renderChart() {
    const ctx = document.getElementById('rankChart').getContext('2d');
    Chart.defaults.color = CONFIG.chart.defaultColor;
    Chart.defaults.borderColor = CONFIG.chart.defaultBorderColor;

    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: chartData.labels, datasets: chartData.datasets },
        options: getChartOptions(),
        plugins: [deltaLabelPlugin]
    });
}

// ============ View Management ============
function updateView(view) {
    currentView = view;

    // Update button UI states
    document.getElementById('btnScore').classList.toggle('active', view === 'score');
    document.getElementById('btnRank').classList.toggle('active', view === 'rank');

    if (!chartInstance) return;

    chartInstance.options = getChartOptions(); 

    chartInstance.data.datasets.forEach(dataset => {
        dataset.parsing.yAxisKey = view;
    });

    chartInstance.update();
}

function updateSeasonSelect(season) {
    currentSeason = season;
    soloPlayer = null;
    buildChartDataForSeason(season);
}

// ============ Initialize ============
fetchData();

window.addEventListener('resize', () => {
    if (chartInstance) {
        chartInstance.options = getChartOptions();
        chartInstance.update();
    }
});