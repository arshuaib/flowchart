@echo off
setlocal
cd /d "%~dp0"

if not exist "dist\index.html" (
  echo Building Salary Reset first...
  call pnpm install --frozen-lockfile
  if errorlevel 1 goto failed
  call pnpm build
  if errorlevel 1 goto failed
)

echo Starting Salary Reset at http://localhost:5173
start "Salary Reset local server" cmd /k "pnpm exec vite preview --configLoader runner --host 127.0.0.1 --port 5173 --strictPort"
timeout /t 3 /nobreak >nul
start "" "http://localhost:5173/"
exit /b 0

:failed
echo Salary Reset could not build. Check that Node.js and pnpm are installed.
pause
exit /b 1
