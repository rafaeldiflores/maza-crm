@echo off
title MAZA CRM & Scraper Regional
cd /d "%~dp0"
echo ============================================================
echo   INICIANDO PANEL MAZA CRM Y SCRAPER REGIONAL DE TALLERES   
echo ============================================================
echo.
echo Abriendo servidor en http://localhost:8000
echo Puedes acceder desde tu notebook o celular (en la misma red).
echo.
start http://localhost:8000
python -m uvicorn app:app --host 0.0.0.0 --port 8000
pause
