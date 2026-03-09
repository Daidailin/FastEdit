$ErrorActionPreference = "Continue"

Write-Host "Setting PowerShell execution policy..."
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force

Write-Host "Installing npm dependencies..."
npm install

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nDependencies installed successfully!" -ForegroundColor Green
    
    Write-Host "`nBuilding portable exe..."
    npm run build
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nBuild completed!" -ForegroundColor Green
    } else {
        Write-Host "`nBuild failed!" -ForegroundColor Red
    }
} else {
    Write-Host "`nnpm install failed!" -ForegroundColor Red
}

Write-Host "`nPress any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
