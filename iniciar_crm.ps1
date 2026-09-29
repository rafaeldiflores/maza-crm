# Launcher PowerShell para MAZA CRM
Set-Location -Path $PSScriptRoot
Write-Host "============================================================" -ForegroundColor Amber
Write-Host "  INICIANDO PANEL MAZA CRM Y SCRAPER REGIONAL DE TALLERES   " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Amber
Write-Host ""
Write-Host "Servidor Web en: http://localhost:8000" -ForegroundColor Green
Write-Host "Iniciando navegador..." -ForegroundColor Gray
Start-Process "http://localhost:8000"
python -m uvicorn app:app --host 0.0.0.0 --port 8000
