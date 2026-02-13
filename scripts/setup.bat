@echo off
REM SplicR Setup Script for Windows

echo Setting up SplicR...
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Node.js is not installed. Please install Node.js 18+ first.
    exit /b 1
)

REM Check Python
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Python 3 is not installed. Please install Python 3.11+ first.
    exit /b 1
)

echo Prerequisites checked
echo.

REM Set script var
set SCRIPT_DIR=%~dp0
cd /d %SCRIPT_DIR%..

REM Setup Frontend
echo Setting up frontend...
cd frontend

if not exist ".env.local" (
    echo Creating .env.local...
    echo NEXT_PUBLIC_API_URL=http://localhost:8000 > .env.local
)

echo Installing frontend dependencies...
call npm install

echo Frontend setup complete
echo.

REM Setup Backend
echo Setting up backend...
cd ..\backend

if not exist "venv" (
    echo Creating Python virtual environment...
    python -m venv venv
)

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Installing backend dependencies...
pip install -r requirements.txt

echo Backend setup complete
echo.

echo Setup complete!
echo.
echo To start the development servers:
echo.
echo Frontend (in terminal 1):
echo   cd frontend
echo   npm run dev
echo.
echo Backend (in terminal 2):
echo   cd backend
echo   venv\Scripts\activate.bat
echo   uvicorn main:app --reload
echo.
echo Then visit http://localhost:3000
echo.

pause
