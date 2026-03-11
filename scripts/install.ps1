<#
.SYNOPSIS
A fluid, automated installer for Nexus AI on Windows.
#>

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "          __  __     " -ForegroundColor Cyan
Write-Host "       _ / / / /___  _  ____  _______" -ForegroundColor Cyan
Write-Host "      / /_/ / / __ \| |/_/ / / / ___/" -ForegroundColor Cyan
Write-Host "     / __  / / /_/ />  </ /_/ (__  ) " -ForegroundColor Cyan
Write-Host "    /_/ /_/_/\____/_/|_|\__,_/____/  " -ForegroundColor Cyan
Write-Host "        N E X U S   A I   v1.0       " -ForegroundColor Magenta
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check for Node.js
Write-Host "[1/4] Checking for Node.js..." -NoNewline
if (Get-Command "node" -ErrorAction SilentlyContinue) {
    Write-Host " [OK]" -ForegroundColor Green
    node -v
} else {
    Write-Host " [FAILED]" -ForegroundColor Red
    Write-Host "Node.js is not installed. Please install Node.js (v18+) from nodejs.org to proceed." -ForegroundColor Yellow
    exit 1
}

# 2. Check for Git
Write-Host "[2/4] Checking for Git..." -NoNewline
if (Get-Command "git" -ErrorAction SilentlyContinue) {
    Write-Host " [OK]" -ForegroundColor Green
} else {
    Write-Host " [FAILED]" -ForegroundColor Red
    Write-Host "Git is not installed. Please install Git to proceed." -ForegroundColor Yellow
    exit 1
}

# 3. Clone Repository
$RepoUrl = "https://github.com/Vishnu852002/myownweb.git" # Example URL, adjust to final public generic
$InstallDir = Join-Path $HOME "nexus-ai"

Write-Host "[3/4] Cloning Nexus AI into $InstallDir..."
if (Test-Path $InstallDir) {
    Write-Host "Directory already exists. Removing old installation..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $InstallDir
}
git clone $RepoUrl $InstallDir

# 4. Install Dependencies
Set-Location $InstallDir
Write-Host "[4/4] Installing dependencies (this may take a minute)..."
npm install --production

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  Nexus AI has been installed successfully!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "To start the application, run:" -ForegroundColor Cyan
Write-Host "  cd ~/nexus-ai"
Write-Host "  npm start"
Write-Host ""
Write-Host "To run as a native Desktop App (Power User):" -ForegroundColor Cyan
Write-Host "  npm run start:app"
Write-Host ""
