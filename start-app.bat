@echo off
title IBKR App
REM Go to the folder this file lives in (the project folder)
cd /d "%~dp0"

REM Open the app in the browser after a short delay (gives the server time to start)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"

REM Start the server (this also connects to the local database in data\ibkr.db).
REM --watch-path: when code changes, the server restarts by itself and the open
REM browser page refreshes automatically. Your data folder is NOT watched, so
REM uploading statements or saving values never triggers a restart.
REM Your private IBKR token and GOOGLE_SHEET_ID are loaded by paths.js from the
REM .env file set in paths.json (outside the project, never uploaded to GitHub).
REM No paths.json yet? Copy paths.example.json to paths.json and edit the paths.
node --watch-path=server.js --watch-path=paths.js --watch-path=paths.json --watch-path=db.js --watch-path=parser.js --watch-path=colorizer.js --watch-path=flex.js --watch-path=sheets.js --watch-path=fx.js --watch-path=public server.js

REM If the server stops, keep the window open so you can read the error
pause
