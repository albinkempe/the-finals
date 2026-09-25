# --- Configuration ---
$Players    = @("Trumman#6019", "turbo#9840", "mike#2329")
$RepoRoot   = "$HOME\Projects\the-finals"
$OutputFile = "$RepoRoot\data\rank_data.csv"

# --- Sync repo first, so we're reading/writing against the latest CSV ---
Push-Location $RepoRoot
if (Test-Path ".git") {
    git checkout main
    git pull --rebase origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Pull failed — aborting." -ForegroundColor Red
        Pop-Location
        exit 1
    }
}
Pop-Location

# --- Auto-detect current season by trying incrementally ---
# Reads the last recorded season from the CSV as a starting point, then probes
# s+1, s+2 etc. until the API stops returning data. Falls back to s1 if no CSV exists.
Write-Host "--- Detecting current season ---" -ForegroundColor Cyan

$StartSeason = 1
if (Test-Path $OutputFile) {
    $LastRow = Import-Csv $OutputFile | Select-Object -Last 1
    if ($LastRow -and $LastRow.season -match "^s(\d+)$") {
        $StartSeason = [int]$Matches[1]
    }
}

$Season      = $null
$TestPlayer  = [uri]::EscapeDataString($Players[0])

for ($i = $StartSeason; $i -le ($StartSeason + 5); $i++) {
    $TestSeason = "s$i"
    $TestUrl    = "https://api.the-finals-leaderboard.com/v1/leaderboard/$TestSeason/crossplay?name=$TestPlayer"
    try {
        $TestResponse = Invoke-RestMethod -Uri $TestUrl -Method Get
        if ($null -ne $TestResponse.data -and $TestResponse.data.Count -gt 0) {
            $Season = $TestSeason   # This season has data, keep going to find the latest
        } else {
            break                   # No data means we've gone past the current season
        }
    } catch {
        break                       # API error also means we've gone too far
    }
}

if ($null -eq $Season) {
    Write-Host " [!] Could not detect season. Defaulting to s$StartSeason." -ForegroundColor Yellow
    $Season = "s$StartSeason"
} else {
    Write-Host " [OK] Current season detected: $Season" -ForegroundColor Green
}

# --- Check if already run today (based on CSV content, not file timestamp) ---
$TodayStr = (Get-Date -Format "yyyy-MM-dd")
if (Test-Path $OutputFile) {
    $AlreadyRan = Import-Csv $OutputFile | Where-Object { $_.recordedAt -like "$TodayStr*" }
    if ($AlreadyRan) {
        Write-Host "Skipping: Data has already been fetched today ($TodayStr)." -ForegroundColor Yellow
        exit
    }
}

Write-Host "--- Fetching The Finals Data (Season: $Season) ---" -ForegroundColor Cyan

# --- Fetch data for each player ---
$FinalResults = foreach ($Player in $Players) {
    $EncodedName = [uri]::EscapeDataString($Player)
    $Url = "https://api.the-finals-leaderboard.com/v1/leaderboard/$Season/crossplay?name=$EncodedName"

    try {
        $Response = Invoke-RestMethod -Uri $Url -Method Get

        if ($null -ne $Response.data -and $Response.data.Count -gt 0) {
            Write-Host " [OK] Found data for $Player" -ForegroundColor Green
            $Response.data[0] | Select-Object *,
                @{Name='season';     Expression={$Season}},
                @{Name='recordedAt'; Expression={(Get-Date -Format "yyyy-MM-dd HH:mm")}}
        } else {
            Write-Host " [!] No data returned for $Player (check spelling/ID)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host " [X] Error reaching API for $Player`: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# --- Save to CSV ---
if ($null -ne $FinalResults) {
    $FinalResults | Export-Csv -Path $OutputFile -Append -NoTypeInformation -UseQuotes AsNeeded
    Write-Host "`nSuccess! Data saved to $OutputFile" -ForegroundColor Green
    $FinalResults | Format-Table Name, Rank, League, RankScore -AutoSize

    Write-Host "`n--- Pushing to Git ---" -ForegroundColor Cyan
    Push-Location $RepoRoot
    try {
        $GitStatus = git status --porcelain
        if ($GitStatus) {
            git add $OutputFile
            git commit -m "Update rank data: $TodayStr"
            git push
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Push failed — commit is local only, will retry next run." -ForegroundColor Red
            } else {
                Write-Host "Changes pushed to repository successfully." -ForegroundColor Green
            }
        } else {
            Write-Host "No changes to commit (data unchanged)." -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "`nNo data was collected." -ForegroundColor Red
}