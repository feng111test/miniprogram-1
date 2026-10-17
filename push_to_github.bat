@echo off
setlocal

if "%~1"=="" (
    echo Usage: push_to_github.bat https://github.com/your-name/repo.git
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push_to_github.ps1" -RemoteUrl "%~1" %*
