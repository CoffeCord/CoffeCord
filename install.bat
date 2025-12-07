@echo off
chcp 65001 >nul
set nodeinstalled=no
set gitinstalled=no
set chocoinstalled=no
set scriptdir="%~dp0%~nx0"

cls
echo.
echo   _____ ____  ______ ______ ______ _____ ____  _____  _____
echo  / ____/ __ \^|  ____^|  ____^|  ____/ ____/ __ \^|  __ \^|  __ \
echo ^| ^|   ^| ^|  ^| ^| ^|__  ^| ^|__  ^| ^|__ ^| ^|   ^| ^|  ^| ^| ^|__) ^| ^|  ^| ^|
echo ^| ^|   ^| ^|  ^| ^|  __^| ^|  __^| ^|  __^|^| ^|   ^| ^|  ^| ^|  _  /^| ^|  ^| ^|
echo ^| ^|___^| ^|__^| ^| ^|    ^| ^|    ^| ^|___^| ^|___^| ^|__^| ^| ^| \ \^| ^|__^| ^|
echo  \_____\____/^|_^|    ^|_^|    ^|______\_____\____/^|_^|  \_\_____/
echo.
echo ===============================================================
echo           W R I T T E N   B Y
echo ===============================================================
echo.
echo         @nyzxor/yoshi  ^|  @alwaysimpure/A.G
echo.
echo                    on discord
echo ===============================================================
echo.
echo coffecord is a fork of equicord, developed by nyzxor/yoshi, alwaysimpure/A.G and overocai.
echo.
echo press any key to continue.
pause >nul

goto checkprivileges

:UACEXIT
echo This script will not function if UAC is disabled. Please enable User Access Control.
pause>nul
exit /B 0

:checkprivileges
reg query "HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v "ConsentPromptBehaviorAdmin" | find  "0x0" >NUL
if "%ERRORLEVEL%"=="0" goto UACEXIT

net file 1>NUL 2>NUL
if not '%errorlevel%' == '0' (
	pnpm -v >nul 2>&1
	if %errorlevel%==0 goto installequicord
	echo script is not elevated, elevating...
    powershell Start-Process -FilePath "%0" -ArgumentList "%cd%" -verb runas >NUL 2>&1
    exit /b
) else (
	echo script is elevated, checking dependencies...
	goto checkDependencies
)

cd /d %1
exit /B 0

:restartscriptunelevated
runas /trustlevel:0x20000 "cmd.exe /k %scriptdir%"
exit /B 0

:installchoco
echo.
echo Installing chocolatey...
@"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -InputFormat None -ExecutionPolicy Bypass -Command " [System.Net.ServicePointManager]::SecurityProtocol = 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))" && SET "PATH=%PATH%;%ALLUSERSPROFILE%\chocolatey\bin"
call refreshenv
goto checkDependencies

:installnode
echo.
echo Installing Node.js...
choco install nodejs-lts -y
call refreshenv
goto checkDependencies

:installgit
echo.
echo Installing Git...
choco install git.install -y
call refreshenv
goto checkDependencies

:installpnpm
echo.
echo Installing pnpm...
npm i -g pnpm@10.17.1
goto restartscriptunelevated

:checkDependencies
set scriptdir="%~dp0%~nx0"

echo.
echo ========================================
echo Checking Dependencies...
echo ========================================
echo.

echo [1/3] Checking for Chocolatey...
choco -v >nul 2>&1
if %errorlevel%==0 (
	set chocoinstalled=yes
	echo [OK] Chocolatey is installed
) else (
	echo [NOT FOUND] Chocolatey is not installed
)
echo.

echo [2/3] Checking for Node.js...
node -v >nul 2>&1
if %errorlevel%==0 (
	set nodeinstalled=yes
	echo [OK] Node.js is installed
) else (
	echo [NOT FOUND] Node.js is not installed
)
echo.

echo [3/3] Checking for Git...
git --version >nul 2>&1
if %errorlevel%==0 (
	set gitinstalled=yes
	echo [OK] Git is installed
) else (
	echo [NOT FOUND] Git is not installed
)
echo.
echo ========================================

echo.
echo All dependencies checked!
echo Node: %nodeinstalled% ^| Git: %gitinstalled% ^| Choco: %chocoinstalled%
echo.

if "%nodeinstalled%"=="yes" if "%gitinstalled%"=="yes" goto installequicord
if "%nodeinstalled%"=="yes" if "%gitinstalled%"=="no" if "%chocoinstalled%"=="yes" goto installgit
if "%nodeinstalled%"=="yes" if "%gitinstalled%"=="no" if "%chocoinstalled%"=="no" goto installchoco
if "%nodeinstalled%"=="no" if "%chocoinstalled%"=="yes" goto installnode
if "%nodeinstalled%"=="no" if "%chocoinstalled%"=="no" goto installchoco

echo ERROR: Unexpected state
pause
exit /b 1

:installequicord
pnpm -v >nul 2>&1
if not %errorlevel%==0 (
	echo pnpm not installed
	goto installpnpm
)
echo pnpm installed

cd /d "%~dp0"

net file 1>NUL 2>NUL
if not '%errorlevel%' == '0' (
	echo.
	echo ========================================
	echo Installing coffecord dependencies...
	echo ========================================
	pnpm install --no-frozen-lockfile
	if errorlevel 1 (
		echo.
		echo ERROR: Failed to install dependencies!
		pause
		exit /b 1
	)

	echo.
	echo ========================================
	echo Building coffecord...
	echo ========================================
	pnpm build
	if errorlevel 1 (
		echo.
		echo ERROR: Failed to build coffecord!
		pause
		exit /b 1
	)

	echo.
	echo ========================================
	echo Inject Options
	echo ========================================
	echo.
	echo Choose injection method:
	echo [1] Normal Inject (Current Discord installation)
	echo [2] Inject All (All Discord installations)
	echo.
	set /p inject_choice="Enter your choice (1 or 2): "

	if "%inject_choice%"=="1" goto injectnormal
	if "%inject_choice%"=="2" goto injectall

	echo.
	echo ERROR: Invalid choice!
	pause
	exit /b 1
) else (
	echo Script is elevated, de-elevating for installation...
	goto restartscriptunelevated
)

:injectnormal
echo.
echo ========================================
echo Injecting coffecord (Normal)...
echo ========================================
echo.
pnpm inject
if errorlevel 1 (
	echo.
	echo ERROR: Failed to inject coffecord!
	echo Make sure Discord is closed before injecting.
	pause
	exit /b 1
)
goto installcomplete

:injectall
echo.
echo ========================================
echo Injecting coffecord (All Installations)...
echo ========================================
echo.
echo Injecting into Discord Stable...
node scripts/runInstaller.mjs -- --install -branch stable
echo.
echo Injecting into Discord PTB...
node scripts/runInstaller.mjs -- --install -branch ptb
echo.
echo Injecting into Discord Canary...
node scripts/runInstaller.mjs -- --install -branch canary
echo.
echo All installations completed!
goto installcomplete

:installcomplete
echo.
echo ========================================
echo coffecord installation completed!
echo ========================================
echo.
pause
exit
