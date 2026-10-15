@echo off
title School Management System - Live Public Tunnel
echo ========================================================
echo   School Management System - Live Tunnel Keepalive
echo ========================================================
echo Forwarding local port 3000 to public HTTPS via Serveo...
echo Press Ctrl+C to stop.
echo.

:loop
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=20 -p 443 -R0:127.0.0.1:3000 b@a.pinggy.io
echo [Tunnel disconnected] Reconnecting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
