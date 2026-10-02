@echo off
title KE Assistant - local server
cd /d "%~dp0"
echo Iniciando KE Assistant local server...
echo (deja esta ventana abierta mientras uses el userscript)
echo.
npm start
echo.
echo El server se detuvo o fallo. Revisa el error de arriba.
pause
