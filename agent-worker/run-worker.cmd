@echo off
setlocal EnableDelayedExpansion

echo Loading environment from .env ...
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
    set "%%a=%%b"
)

echo Starting RestPilot agent worker...
node dist/worker.js
