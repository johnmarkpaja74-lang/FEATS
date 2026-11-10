@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo FEATS needs Node.js 24 or newer. Install Node.js, then open this file again.
 pause
 exit /b 1
)
node start.cjs --open
if errorlevel 1 pause
