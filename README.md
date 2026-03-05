# The Finals | Rank Tracker

A leaderboard rank tracker for [The Finals](https://www.reachthefinals.com/), built for HSD Esports. Automatically fetches daily rank data and visualises player progression across seasons.

## What it does

- Fetches rank data daily from the [The Finals leaderboard API](https://api.the-finals-leaderboard.com) via a scheduled PowerShell script
- Appends results to a CSV and auto-commits to this repo
- Displays rank history on an interactive chart — toggle between **Score View** and **Rank View**, and filter by season

## Repo structure

```
the-finals/
├── data/
│   ├── rank_data.csv       # Historical rank data (auto-updated daily)
│   └── seasons.csv         # Season start/end dates
├── scripts/
│   └── fetch-ranks.ps1     # Scheduled data-fetching script
├── web/
│   ├── index.html
│   ├── script.js
│   ├── styles.css
│   ├── favicon.png
│   └── the_finals_logo.png
└── README.md
```

## Setup

### Data fetching

1. Edit `scripts/fetch-ranks.ps1` and update the `$Players` array with your player IDs (e.g. `"Name#1234"`)
2. Update `$RepoRoot` to match your local repo path
3. Schedule the script to run daily via **Task Scheduler**:
   - Program: `pwsh.exe`
   - Arguments: `-File "C:\path\to\scripts\fetch-ranks.ps1"`
   - Trigger: Daily at your preferred time

The script will:
- Auto-detect the current season
- Skip if data has already been fetched today
- Append new rows to `data/rank_data.csv`
- Commit and push the change automatically

### Web

Hosted via GitHub Pages. No build step — it's plain HTML/JS reading the CSV directly.

If serving from the `web/` subdirectory, set your GitHub Pages source to that folder under **Settings → Pages**.

## Dependencies

- [Chart.js](https://www.chartjs.org/)
- [PapaParse](https://www.papaparse.com/)
- [chartjs-plugin-annotation](https://www.chartjs.org/chartjs-plugin-annotation/)