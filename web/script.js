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
            stepSize: 250,
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
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHitRadius: 8
    }
};

// ============ State ============
let chartInstance = null;
let chartData = { labels: [], datasets: [] };
let currentView = 'score';
let fullData = [];
let currentSeason = 'All';
let seasonsMap = {}; // e.g. { S9: { startDate: '2025-12-10', endDate: '2026-03-18' } }

// ============ Utilities ============
const getDayInSeason = (timestamp, season) => {
    const info = seasonsMap[season ? season.toUpperCase() : ''];
    if (!info) return timestamp.split(' ')[0]; // fallback to date string
    const start = new Date(info.startDate);
    const date = new Date(timestamp.split(' ')[0]);
    return Math.floor((date - start) / 86400000) + 1;
};

const createDataset = (player, data, color) => ({
    label: player,
    data,
    borderColor: color,
    backgroundColor: color + '33',
    pointBackgroundColor: color,
    pointBorderColor: color,
    borderWidth: CONFIG.dataset.borderWidth,
    pointRadius: CONFIG.dataset.pointRadius,
    pointHoverRadius: CONFIG.dataset.pointHoverRadius,
    pointHitRadius: CONFIG.dataset.pointHitRadius,
    fill: false,
    pointStyle: 'circle',
    tension: 0,
    parsing: { yAxisKey: currentView }
});

// ============ Delta Label Plugin ============
const deltaLabelPlugin = {
    id: 'deltaLabel',
    afterDatasetsDraw(chart) {
        const { ctx, scales: { x, y } } = chart;
        const yKey = currentView; // 'score' or 'rank'

        chart.data.datasets.forEach((dataset, i) => {
            if (!chart.isDatasetVisible(i)) return;

            const points = dataset.data;
            if (!points || points.length < 2) return;

            const last = points[points.length - 1];
            const prev = points[points.length - 2];

            const lastVal = last[yKey];
            const prevVal = prev[yKey];
            if (lastVal == null || prevVal == null) return;

            const delta = lastVal - prevVal;
            if (delta === 0) return;

            // For rank view, lower rank number = improvement, so flip sign for display
            const displayDelta = yKey === 'rank' ? -delta : delta;
            const sign = displayDelta > 0 ? '+' : '';
            const label = `${sign}${displayDelta.toLocaleString()}`;

            const xPx = x.getPixelForValue(last.x) + 8;
            const yPx = y.getPixelForValue(lastVal);

            ctx.save();
            ctx.font = `bold ${window.innerWidth < 600 ? '9px' : '11px'} "Segoe UI", Roboto, Arial, sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';

            // Colour: green-ish for improvement, red-ish for decline
            // Improvement = score up OR rank number down
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

        // Parse seasons first
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

        // Then parse rank data
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

    if (seasons.length > 0) currentSeason = seasons[seasons.length - 1];
    buildChartDataForSeason(currentSeason);
}

function populateSeasonOptions(seasons) {
    const select = document.getElementById('seasonSelect');
    if (!select) return;
    select.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = 'All';
    allOpt.textContent = 'All Seasons';
    select.appendChild(allOpt);

    seasons.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        select.appendChild(opt);
    });

    select.value = currentSeason || seasons[seasons.length - 1] || 'All';
    select.addEventListener('change', (e) => updateSeasonSelect(e.target.value));
}

function getViewBounds(season) {
    const filtered = season && season !== 'All'
        ? fullData.filter(item => item.season === season)
        : fullData.slice();

    const scores = filtered.map(item => item.rankScore).filter(Boolean);
    const ranks = filtered.map(item => item.rank).filter(Boolean);

    return {
        score: {
            yMin: scores.length ? Math.floor(Math.min(...scores) / 2500) * 2500 - 2500 : 30000,
            yMax: scores.length ? Math.ceil(Math.max(...scores) / 2500) * 2500 + 2500 : 50000,
        },
        rank: {
            yMin: 1,
            yMax: ranks.length ? Math.ceil(Math.max(...ranks) / 250) * 250 + 250 : 1000,
        }
    };
}

function buildChartDataForSeason(season) {
    const filtered = season && season !== 'All'
        ? fullData.filter(item => item.season === season)
        : fullData.slice();

    // Build sorted unique day labels, always starting from day 1
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

// ============ Chart Annotations ============
function getAnnotations(view) {
    const annotations = {
        score: {
            diamondZone: {
                type: 'box',
                yMin: 40000,
                yMax: 50000,
                backgroundColor: 'rgba(0, 251, 255, 0.1)',
                borderColor: 'transparent'
            },
            diamondLine: {
                type: 'line',
                yMin: 40000,
                yMax: 40000,
                borderColor: 'rgba(0, 251, 255, 0.6)',
                borderWidth: 3,
                drawTime: 'beforeDatasetsDraw'
            }
        },
        rank: {
            top500Zone: {
                type: 'box',
                yMin: 1,
                yMax: 500,
                backgroundColor: 'rgba(255, 0, 0, 0.1)',
                borderColor: 'transparent',
                drawTime: 'beforeDatasetsDraw'
            },
            top500Line: {
                type: 'line',
                yMin: 500,
                yMax: 500,
                borderColor: 'rgba(255, 0, 0, 0.6)',
                borderWidth: 3
            }
        }
    };
    return annotations[view];
}

// ============ Chart Rendering ============
function getChartOptions() {
    const bounds = getViewBounds(currentSeason);
    const showingMultiSeason = !currentSeason || currentSeason === 'All';

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
                        return chart.data.datasets.map((dataset, i) => {
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
                    const onlyThisVisible = ci.data.datasets.every((_, i) =>
                        i === index ? ci.isDatasetVisible(i) : !ci.isDatasetVisible(i)
                    );

                    if (onlyThisVisible) {
                        ci.data.datasets.forEach((_, i) => ci.show(i));
                    } else {
                        ci.data.datasets.forEach((_, i) => {
                            i === index ? ci.show(i) : ci.hide(i);
                        });
                    }
                }
            },
            tooltip: {
                backgroundColor: CONFIG.chart.tooltipBg,
                titleColor: '#fff',
                bodyColor: '#fff',
                padding: 10,
                borderColor: CONFIG.chart.tooltipBorder,
                borderWidth: 2,
                boxWidth: 6,
                boxHeight: 6,
                usePointStyle: true,
                displayColors: false,
                callbacks: {
                    title: (items) => {
                        const day = items[0]?.label;
                        return showingMultiSeason ? `Day ${day}` : `Day ${day}`;
                    },
                    label: (context) => {
                        const { score, rank, league, season, date } = context.raw;
                        const lines = [
                            `Player: ${context.dataset.label}`,
                            `Date: ${date}`,
                            `Score: ${score ? score.toLocaleString() : 'N/A'}`,
                            `League: ${league}`
                        ];
                        if (rank != null) lines.splice(3, 0, `Rank: ${rank.toLocaleString()}`);
                        if (showingMultiSeason) lines.push(`Season: ${season}`);
                        return lines;
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'linear',
                grid: { display: false },
                min: 1,
                title: {
                    display: false,
                    text: showingMultiSeason ? 'Day of Season' : `Day of ${currentSeason}`,
                    color: '#fff'
                },
                ticks: {
                    maxTicksLimit: 10,
                    callback: (val) => `Day ${val}`
                }
            },
            y: {
                reverse: CONFIG.views[currentView].reverse,
                title: { display: true, text: CONFIG.views[currentView].label, color: '#fff' },
                grid: { color: CONFIG.chart.gridColor },
                min: bounds[currentView].yMin,
                suggestedMax: bounds[currentView].yMax,
                ticks: {
                    stepSize: CONFIG.views[currentView].stepSize,
                    font: { size: window.innerWidth < 600 ? 10 : 12 }
                },
                afterFit: (axis) => { axis.width = window.innerWidth < 600 ? 55 : 80; }
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