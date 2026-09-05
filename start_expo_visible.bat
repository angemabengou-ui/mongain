@echo off
echo ===================================
echo   LANCEMENT EXPO SDK 57 (Mongain)
echo ===================================
set PATH=D:\kimi\resources\resources\runtime;D:\Applications;%PATH%
cd d:\Users\om0886\Desktop\mongain
call npm install expo@57.0.0
call npm run start
echo.
echo Le processus s'est termine.
pause
