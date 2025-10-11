@echo off
echo 🎧 Starting United Family Caregivers Rep Dashboard
echo ================================================

REM Ensure we're in the correct directory
cd /d "%~dp0"
echo 📁 Working directory: %CD%

REM Kill any existing servers
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1

echo ✅ Cleared existing servers

REM Check if files exist
if exist "rep-assistant.html" (
    echo ✅ Rep assistant file found
) else (
    echo ❌ Rep assistant file missing
    pause
    exit /b 1
)

if exist "KloudyAiChatFavicon.png" (
    echo ✅ Favicon found
) else (
    echo ❌ Favicon missing
    pause
    exit /b 1
)

REM Start Node.js server from THIS directory
echo 🚀 Starting server on port 8717...
node serve-frontend.js

pause
