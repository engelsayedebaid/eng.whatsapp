@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ╔════════════════════════════════════════════════════════════╗
echo ║     WhatsApp Clone - Project Duplicator                    ║
echo ║     Creates a complete independent copy of the project     ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

:: Get timestamp using PowerShell
for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set TIMESTAMP=%%i

:: Source and destination paths
set SOURCE_DIR=%~dp0
set DESKTOP=%USERPROFILE%\Desktop
set NEW_PROJECT_NAME=whatsapp-clone-%TIMESTAMP%
set DEST_DIR=%DESKTOP%\%NEW_PROJECT_NAME%

:: Port configuration (different from original)
set BACKEND_PORT=3001
set FRONTEND_PORT=4201

echo [1/7] Creating new project folder...
echo       Destination: %DEST_DIR%
mkdir "%DEST_DIR%" 2>nul
mkdir "%DEST_DIR%\backend" 2>nul
mkdir "%DEST_DIR%\frontend" 2>nul

echo.
echo [2/7] Copying backend files...

:: Copy backend using xcopy (more reliable)
xcopy "%SOURCE_DIR%backend\src" "%DEST_DIR%\backend\src" /E /I /H /Y /Q
xcopy "%SOURCE_DIR%backend\package.json" "%DEST_DIR%\backend\" /Y /Q
xcopy "%SOURCE_DIR%backend\package-lock.json" "%DEST_DIR%\backend\" /Y /Q 2>nul

echo.
echo [3/7] Copying frontend files...

:: Copy frontend structure
xcopy "%SOURCE_DIR%frontend\src" "%DEST_DIR%\frontend\src" /E /I /H /Y /Q
xcopy "%SOURCE_DIR%frontend\angular.json" "%DEST_DIR%\frontend\" /Y /Q
xcopy "%SOURCE_DIR%frontend\package.json" "%DEST_DIR%\frontend\" /Y /Q
xcopy "%SOURCE_DIR%frontend\package-lock.json" "%DEST_DIR%\frontend\" /Y /Q 2>nul
xcopy "%SOURCE_DIR%frontend\tsconfig.json" "%DEST_DIR%\frontend\" /Y /Q
xcopy "%SOURCE_DIR%frontend\tsconfig.app.json" "%DEST_DIR%\frontend\" /Y /Q 2>nul
xcopy "%SOURCE_DIR%frontend\tsconfig.spec.json" "%DEST_DIR%\frontend\" /Y /Q 2>nul

:: Copy public folder if exists
if exist "%SOURCE_DIR%frontend\public" (
    xcopy "%SOURCE_DIR%frontend\public" "%DEST_DIR%\frontend\public" /E /I /H /Y /Q
)

echo.
echo [4/7] Creating empty data and session folders...
mkdir "%DEST_DIR%\backend\data" 2>nul
mkdir "%DEST_DIR%\backend\.wwebjs_auth" 2>nul

:: Create empty accounts.json
echo { > "%DEST_DIR%\backend\data\accounts.json"
echo   "activeAccountId": null, >> "%DEST_DIR%\backend\data\accounts.json"
echo   "accounts": [] >> "%DEST_DIR%\backend\data\accounts.json"
echo } >> "%DEST_DIR%\backend\data\accounts.json"

echo.
echo [5/7] Updating port configuration...

:: Update backend port
powershell -NoProfile -Command ^
    "$f='%DEST_DIR%\backend\src\index.js'; if(Test-Path $f){(Get-Content $f) -replace 'PORT \|\| 3000','PORT || %BACKEND_PORT%' | Set-Content $f}"

:: Update frontend whatsapp.service.ts
powershell -NoProfile -Command ^
    "$f='%DEST_DIR%\frontend\src\app\core\services\whatsapp.service.ts'; if(Test-Path $f){(Get-Content $f -Raw) -replace 'localhost:3000','localhost:%BACKEND_PORT%' | Set-Content $f}"

:: Update frontend socket.service.ts
powershell -NoProfile -Command ^
    "$f='%DEST_DIR%\frontend\src\app\core\services\socket.service.ts'; if(Test-Path $f){(Get-Content $f -Raw) -replace 'localhost:3000','localhost:%BACKEND_PORT%' | Set-Content $f}"

echo.
echo [6/7] Installing dependencies (this may take a few minutes)...
echo       Installing backend dependencies...
cd /d "%DEST_DIR%\backend"
call npm install --legacy-peer-deps

echo.
echo       Installing frontend dependencies...
cd /d "%DEST_DIR%\frontend"
call npm install --legacy-peer-deps

echo.
echo [7/7] Creating startup scripts...

:: Create start.bat
echo @echo off > "%DEST_DIR%\start.bat"
echo chcp 65001 ^>nul >> "%DEST_DIR%\start.bat"
echo echo Starting WhatsApp Clone... >> "%DEST_DIR%\start.bat"
echo echo   Backend:  http://localhost:%BACKEND_PORT% >> "%DEST_DIR%\start.bat"
echo echo   Frontend: http://localhost:%FRONTEND_PORT% >> "%DEST_DIR%\start.bat"
echo start "Backend-%BACKEND_PORT%" cmd /k "cd /d %DEST_DIR%\backend && npm run dev" >> "%DEST_DIR%\start.bat"
echo timeout /t 5 /nobreak ^>nul >> "%DEST_DIR%\start.bat"
echo start "Frontend-%FRONTEND_PORT%" cmd /k "cd /d %DEST_DIR%\frontend && ng serve --port %FRONTEND_PORT% --open" >> "%DEST_DIR%\start.bat"

:: Create stop.bat
echo @echo off > "%DEST_DIR%\stop.bat"
echo taskkill /F /FI "WINDOWTITLE eq Backend-%BACKEND_PORT%*" 2^>nul >> "%DEST_DIR%\stop.bat"
echo taskkill /F /FI "WINDOWTITLE eq Frontend-%FRONTEND_PORT%*" 2^>nul >> "%DEST_DIR%\stop.bat"
echo echo Servers stopped. >> "%DEST_DIR%\stop.bat"
echo pause >> "%DEST_DIR%\stop.bat"

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                      COMPLETE!                             ║
echo ╠════════════════════════════════════════════════════════════╣
echo ║  New project: %NEW_PROJECT_NAME%
echo ║                                                            ║
echo ║  Backend:  http://localhost:%BACKEND_PORT%                           ║
echo ║  Frontend: http://localhost:%FRONTEND_PORT%                          ║
echo ║                                                            ║
echo ║  To start: Double-click start.bat in the new folder       ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

set /p START_NOW="Start the new project now? (Y/N): "
if /i "%START_NOW%"=="Y" (
    cd /d "%DEST_DIR%"
    call start.bat
)

pause
