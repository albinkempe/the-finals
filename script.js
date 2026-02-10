const csvUrl = 'rank_data.csv';
let chartInstance = null;
let globalLabels = [];
let globalDatasets = [];
let currentView = 'score';

async function fetchData() {
    try {
        const response = await fetch(csvUrl);
        const csvText = await response.text();

        Papa.parse(csvText, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: function (results) {
                processData(results.data);
            }
        });
    } catch (error) {
        console.error("Error loading CSV:", error);
    }
}

function processData(data) {
    if (!data || !Array.isArray(data)) return;

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    };

    const cleanData = data
        .filter(row => row.RecordedAt && row.steamName)
        .sort((a, b) => new Date(a.RecordedAt) - new Date(b.RecordedAt));

    globalLabels = [...new Set(cleanData.map(item => formatDate(item.RecordedAt.split(' ')[0])))];

    const groupedByPlayer = cleanData.reduce((acc, item) => {
        const playerName = item.steamName;
        if (!acc[playerName]) acc[playerName] = [];

        acc[playerName].push({
            x: formatDate(item.RecordedAt.split(' ')[0]),
            score: item.rankScore,
            rank: item.rank,
            league: item.league
        });
        return acc;
    }, {});

    const colors = ['#ff0df7', '#ff7a0d', '#0dff25'];

    globalDatasets = Object.keys(groupedByPlayer).map((player, index) => {
        const color = colors[index % colors.length];
        return {
            label: player,
            data: groupedByPlayer[player],
            borderColor: color,
            backgroundColor: color + '33',
            pointBackgroundColor: color,
            pointBorderColor: color,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointHitRadius: 8,
            fill: false,
            pointStyle: 'circle',
            tension: 0,
            parsing: {
                yAxisKey: 'score' // Default parsing key
            }
        };
    });

    renderChart();
}

function updateView(view) {
    currentView = view;

    document.getElementById('btnScore').classList.toggle('active', view === 'score');
    document.getElementById('btnRank').classList.toggle('active', view === 'rank');

    chartInstance.options.scales.y.reverse = (view === 'rank');
    chartInstance.options.scales.y.title.text = view === 'score' ? 'Rank Score' : 'Leaderboard Rank';

    if (view === 'rank') {
        chartInstance.options.scales.y.min = 1;
        chartInstance.options.scales.y.suggestedMax = 1000;
        chartInstance.options.scales.y.ticks.stepSize = 250;
    } else {
        chartInstance.options.scales.y.min = 30000;
        chartInstance.options.scales.y.suggestedMax = 50000;
        chartInstance.options.scales.y.ticks.stepSize = 2500;
    }

    chartInstance.options.plugins.annotation.annotations = getAnnotations(view);

    chartInstance.data.datasets.forEach(dataset => {
        dataset.parsing.yAxisKey = view;
    });

    chartInstance.update();
}

function getAnnotations(view) {
    if (view === 'rank') {
        return {
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
                borderWidth: 3,
            }
        };
    } else {
        return {
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
        };
    }
}

function renderChart() {
    const ctx = document.getElementById('rankChart').getContext('2d');
    Chart.defaults.color = '#a0a0a0';
    Chart.defaults.borderColor = '#1a4875';

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: globalLabels, datasets: globalDatasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                annotation: { annotations: getAnnotations() },
                legend: {
                    position: 'top',
                    labels: {
                        color: '#ffffff',
                        font: { weight: 'bold' },
                        usePointStyle: true,
                        padding: 15,
                        boxWidth: 6,
                        boxHeight: 6
                    }
                },
                tooltip: {
                    backgroundColor: '#080224',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    padding: 10,
                    borderColor: '#383264',
                    borderWidth: 2,
                    boxWidth: 6,
                    boxHeight: 6,
                    usePointStyle: true,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            const raw = context.raw;
                            return [
                                `Player: ${context.dataset.label}`,
                                `Score: ${raw.score.toLocaleString()}`,
                                `Rank: ${raw.rank ? raw.rank.toLocaleString() : 'N/A'}`,
                                `League: ${raw.league}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, offset: true },
                
                y: {
                    reverse: false,
                    title: { display: true, text: 'Rank Score', color: '#fff' },
                    grid: { color: '#1a4875' },
                    ticks: { stepSize: 2500 },
                    afterFit: (axis) => {
                        axis.width = 80;
                    },
                }
            }
        }
    });
}

fetchData();
