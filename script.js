// ============ Configuration ============
const CONFIG = {
    csvUrl: 'rank_data.csv',
    playerColors: ['#ff0df7', '#ff7a0d', '#0dff25'],
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
        tooltipBorder: '#383264'
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

// ============ Utilities ============
const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const getDateFromTimestamp = (timestamp) => formatDate(timestamp.split(' ')[0]);

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
        const response = await fetch(CONFIG.csvUrl);
        const csvText = await response.text();
        Papa.parse(csvText, {
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

    // Save full cleaned data (normalize season to uppercase)
    fullData = cleanData.map(item => ({
        ...item,
        season: item.season ? String(item.season).toUpperCase() : item.season
    }));

    const seasons = [...new Set(fullData.map(item => item.season))].filter(s => s !== undefined && s !== null);
    populateSeasonOptions(seasons);

    // Default to the latest season
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

    // Fix: wire up the change event listener
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

    chartData.labels = [...new Set(filtered.map(item => getDateFromTimestamp(item.recordedAt)))];

    const groupedByPlayer = filtered.reduce((acc, item) => {
        const playerName = item.steamName;
        if (!acc[playerName]) acc[playerName] = [];
        acc[playerName].push({
            x: getDateFromTimestamp(item.recordedAt),
            score: item.rankScore,
            rank: item.rank,
            league: item.league,
            season: item.season
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
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 150 },
        plugins: {
            annotation: { annotations: getAnnotations(currentView) },
            legend: {
                position: 'top',
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
                // Click legend item to isolate/toggle player
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
                    label: (context) => {
                        const { score, rank, league } = context.raw;
                        const lines = [
                            `Player: ${context.dataset.label}`,
                            `Score: ${score ? score.toLocaleString() : 'N/A'}`,
                            `League: ${league}`
                        ];
                        if (rank != null) lines.splice(2, 0, `Rank: ${rank.toLocaleString()}`);
                        return lines;
                    }
                }
            }
        },
        scales: {
            x: { grid: { display: false }, offset: true },
            y: {
                reverse: CONFIG.views[currentView].reverse,
                title: { display: true, text: CONFIG.views[currentView].label, color: '#fff' },
                grid: { color: CONFIG.chart.gridColor },
                min: bounds[currentView].yMin,
                suggestedMax: bounds[currentView].yMax,
                ticks: { stepSize: CONFIG.views[currentView].stepSize },
                afterFit: (axis) => { axis.width = 80; }
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
        options: getChartOptions()
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