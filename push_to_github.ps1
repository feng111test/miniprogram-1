param(
    [string]$RemoteUrl,
    [string]$Branch = "main",
    [string]$CommitMessage = "feat: upload project",
    [string]$GitUserName = "feng111test",
    [string]$GitUserEmail = "13136158311@163.com",
    [switch]$WhatIf,
    [switch]$SkipPush
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

# If the repo already has an 'origin' remote, we can keep it.
# If not, the caller must pass -RemoteUrl.
if (-not $RemoteUrl) {
    try {
        $existingRemote = git remote get-url origin 2>$null
        if ($existingRemote) {
            $RemoteUrl = $existingRemote
        }
    } catch {
        $existingRemote = $null
    }
}

if (-not $RemoteUrl) {
    Write-Host "Usage: .\push_to_github.ps1 -RemoteUrl 'https://github.com/your-name/repo.git' [-Branch main] [-CommitMessage 'feat: upload project'] [-WhatIf] [-SkipPush]"
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
    Write-Host "[WhatIf] git add -A"
    Write-Host "[WhatIf] git commit -m \"$CommitMessage\""
    if (-not $SkipPush) {
        Write-Host "[WhatIf] git push -u origin $Branch"
    }
    Write-Host "Done. In preview mode, no actual Git commands were executed."
    exit 0
}

Write-Host "Configuring Git identity: $GitUserName <$GitUserEmail>"
git config user.name "$GitUserName"
git config user.email "$GitUserEmail"

$hasCommit = $false
try {
    git rev-parse --verify HEAD | Out-Null
    $hasCommit = $true
} catch {
    $hasCommit = $false
}

if (-not $hasCommit) {
    Write-Host "No initial commit found. Creating the first commit..."
    Invoke-Git -Args @("add", "-A")
    Invoke-Git -Args @("commit", "-m", $CommitMessage)
} else {
    $status = git status --porcelain
    if ($status) {
        Write-Host "Detected file changes, staging and committing..."
        Invoke-Git -Args @("add", "-A")
        Invoke-Git -Args @("commit", "-m", $CommitMessage)
    } else {
        Write-Host "Working tree is clean. No new commit needed."
    }
}

$currentBranch = git branch --show-current
if (-not $currentBranch) {
    $currentBranch = "master"
}

if ($currentBranch -ne $Branch) {
    Write-Host "Local branch is '$currentBranch'; renaming it to '$Branch' before push..."
    Invoke-Git -Args @("branch", "-M", $Branch)
}

if ($SkipPush) {
    Write-Host "Skipping push because -SkipPush was provided."
    exit 0
}

Write-Host "Pushing to GitHub branch '$Branch'..."
Invoke-Git -Args @("push", "-u", "origin", $Branch)

Write-Host "Done. Your project has been pushed to GitHub."
