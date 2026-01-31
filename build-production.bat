@echo off
echo ============================================
echo   WhatsApp Clone - Production Build Script
echo ============================================
echo.

cd /d "%~dp0"

echo [1/3] Building Frontend for Production...
cd frontend
call ng build --configuration production
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)

echo.
echo [2/3] Build completed successfully!
echo.
echo Output folder: %~dp0frontend\dist\frontend\browser
echo.

echo [3/3] Creating deployment package...
cd /d "%~dp0"

REM Create deploy folder
if exist "deploy" rmdir /s /q "deploy"
mkdir deploy
mkdir deploy\frontend
mkdir deploy\backend

REM Copy frontend build
xcopy /E /I /Y "frontend\dist\frontend\browser" "deploy\frontend"

REM Copy backend files (excluding node_modules and session data)
xcopy /E /I /Y "backend\src" "deploy\backend\src"
copy /Y "backend\package.json" "deploy\backend\"
copy /Y "backend\package-lock.json" "deploy\backend\" 2>nul

REM Create .gitignore for deploy folder
echo node_modules/ > deploy\backend\.gitignore
echo .wwebjs_auth/ >> deploy\backend\.gitignore
echo .wwebjs_cache/ >> deploy\backend\.gitignore
echo data/ >> deploy\backend\.gitignore

echo.
echo ============================================
echo   BUILD COMPLETE!
echo ============================================
echo.
echo Deployment files are in: %~dp0deploy
echo.
echo Next steps:
echo 1. Upload "deploy\frontend" contents to: /home/quality-qsr/htdocs/quality-qsr.com/
echo 2. Upload "deploy\backend" contents to: /home/quality-qsr/htdocs/quality-qsr.com/api/
echo 3. SSH to VPS and run: cd /home/quality-qsr/htdocs/quality-qsr.com/api ^&^& npm install
echo 4. Start with PM2: pm2 start src/server.js --name whatsapp-api
echo.
pause
