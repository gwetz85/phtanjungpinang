@echo off
title PH Hotel DB - Server
color 0A
echo.
echo  ==========================================
echo    PH Hotel Tanjungpinang - Database Server
echo  ==========================================
echo.
echo  Memulai server...
echo.

cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -Command "node server.js"

echo.
echo  Server berhenti. Tekan tombol apapun untuk keluar...
pause > nul
