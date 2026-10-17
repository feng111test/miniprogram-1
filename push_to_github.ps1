param(
    [string]$RemoteUrl,
    [string]$Branch = "main",
    [string]$CommitMessage = "feat: upload project",
    [string]$GitUserName = "feng111test",
    [string]$GitUserEmail = "13136158311@163.com",
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args
    )

    $commandText = "git " + ($Args -join " ")

    if ($WhatIf) {
        Write-Host "[WhatIf] $commandText"
        return
    }

    & git @Args
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: $commandText"
    }
}

if (-not $RemoteUrl) {
    Write-Host "Usage: .\push_to_github.ps1 -RemoteUrl 'https://github.com/your-name/repo.git' [-Branch main] [-CommitMessage 'feat: upload project'] [-WhatIf]"
    exit 1
}

$repoInitialized = Test-Path ".git"
if (-not $repoInitialized) {
    Write-Host "Repository not initialized, running git init..."
    if ($WhatIf) {
        Write-Host "[WhatIf] git init"
    } else {
        Invoke-Git -Args @("init")
    }
}

$remoteExists = $false
$remoteNames = @()
if (-not $WhatIf) {
    try {
        $remoteNames = git remote
    } catch {
        $remoteNames = @()
    }
}

if ($remoteNames -contains "origin") {
    $remoteExists = $true
}

if ($remoteExists) {
    Write-Host "Updating remote origin..."
    Invoke-Git -Args @("remote", "set-url", "origin", $RemoteUrl)
} else {
    Write-Host "Adding remote origin..."
    Invoke-Git -Args @("remote", "add", "origin", $RemoteUrl)
}

if ($WhatIf) {
    Write-Host "[WhatIf] git config user.name \"$GitUserName\""
    Write-Host "[WhatIf] git config user.email \"$GitUserEmail\""
    Write-Host "[WhatIf] git add ."
    Write-Host "[WhatIf] git commit -m \"$CommitMessage\""
    Write-Host "[WhatIf] git push -u origin $Branch"
    Write-Host "Done. In preview mode, no actual Git commands were executed."
    exit 0
}

Write-Host "Configuring Git identity: $GitUserName <$GitUserEmail>"
git config user.name "$GitUserName"
git config user.email "$GitUserEmail"

$status = git status --porcelain
if ($status) {
    Write-Host "Detected file changes, staging and committing..."
    Invoke-Git -Args @("add", ".")
    Invoke-Git -Args @("commit", "-m", $CommitMessage)
} else {
    Write-Host "Working tree is clean. No new commit needed."
}

Write-Host "Pushing to GitHub branch '$Branch'..."
Invoke-Git -Args @("push", "-u", "origin", $Branch)

Write-Host "Done. Your project has been pushed to GitHub."
