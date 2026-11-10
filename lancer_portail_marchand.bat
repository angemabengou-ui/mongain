@echo off
echo ===================================================
echo   Lancement du Portail Grand Marchand Mongain...
echo ===================================================

echo 1. Lancement du Backend (Port 3000)...
start "Mongain Backend (Port 3000)" cmd /k "set PATH=D:\Users\om0886\Desktop\mongain\.node;D:\Users\om0886\Desktop\mongain\.node22-new;D:\Users\om0886\Desktop\mongain\.node22;%PATH% & cd /d D:\Users\om0886\Desktop\mongain\backend & npm run dev || (echo ERREUR SURVENUE & pause)"

echo 2. Lancement du Portail Web Grand Marchand (Port 5174)...
start "Mongain Portail Grand Marchand (Port 5174)" cmd /k "set PATH=D:\Users\om0886\Desktop\mongain\.node;D:\Users\om0886\Desktop\mongain\.node22-new;D:\Users\om0886\Desktop\mongain\.node22;%PATH% & cd /d D:\Users\om0886\Desktop\mongain\merchant-portal & npm run dev || (echo ERREUR SURVENUE & pause)"

echo.
echo ===================================================
echo Rendez-vous dans votre navigateur sur :
echo http://localhost:5174
echo ===================================================
echo Vous pouvez fermer cette petite fenetre.
timeout /t 5 >nul
