@echo off
setlocal
set "SDK=%ANDROID_HOME%"
if "%SDK%"=="" set "SDK=%LOCALAPPDATA%\Android\Sdk"
set "EMU=%SDK%\emulator\emulator.exe"
set "ADB=%SDK%\platform-tools\adb.exe"
set "APK=%~dp0..\android\app\build\outputs\apk\debug\app-debug.apk"
set "AVD=%~1"
if "%AVD%"=="" set "AVD=Medium_Phone"

echo [1/4] Starting %AVD% Android Emulator...
start "" "%EMU%" -avd %AVD% -no-snapshot-load

echo [2/4] Waiting for emulator to finish booting...
"%ADB%" wait-for-device
:wait_boot
for /f "delims=" %%i in ('"%ADB%" shell getprop sys.boot_completed 2^>nul') do set "BOOT=%%i"
if not "%BOOT%"=="1" (
  timeout /t 2 /nobreak >nul
  goto wait_boot
)

echo [3/4] Setting up adb reverse (8787) and installing Notepad APK...
"%ADB%" reverse tcp:8787 tcp:8787
"%ADB%" install -r "%APK%"

echo [4/4] Launching Notepad...
"%ADB%" shell am start -n io.qzz.qqx.notepad/.MainActivity
echo Done!
endlocal
