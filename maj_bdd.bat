@echo off
echo ===================================================
echo   Mise a jour de la base de donnees en ligne...
echo ===================================================
set PATH=D:\Users\om0886\Desktop\mongain\.node;D:\Users\om0886\Desktop\mongain\.node22-new;D:\Users\om0886\Desktop\mongain\.node22;%PATH%
cd /d D:\Users\om0886\Desktop\mongain\backend
call npx prisma db push --accept-data-loss
echo.
echo Mise a jour terminee ! Vous pouvez fermer cette fenetre et lancer "demarrer_serveurs.bat"
pause

