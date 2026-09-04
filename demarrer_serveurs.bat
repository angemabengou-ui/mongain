@echo off
echo ===================================================
echo   Lancement des serveurs locaux Mongain...
echo ===================================================

echo 1. Lancement du Backend...
start "Mongain Backend (Port 3000)" cmd /k "set PATH=D:\Users\om0886\Desktop\mongain\.node;D:\Users\om0886\Desktop\mongain\.node22-new;D:\Users\om0886\Desktop\mongain\.node22;%PATH% & cd /d D:\Users\om0886\Desktop\mongain\backend & npm run dev || (echo ERREUR SURVENUE & pause)"

echo 2. Lancement du Dashboard Admin...
start "Mongain Admin Web (Port 5173)" cmd /k "set PATH=D:\Users\om0886\Desktop\mongain\.node;D:\Users\om0886\Desktop\mongain\.node22-new;D:\Users\om0886\Desktop\mongain\.node22;%PATH% & cd /d D:\Users\om0886\Desktop\mongain\admin-web & npm run dev || (echo ERREUR SURVENUE & pause)"

echo 3. Lancement de l'Application Mobile Expo...
start "Mongain Mobile Expo (WIFI)" cmd /k "set PATH=D:\Users\om0886\Desktop\mongain\.node;D:\Users\om0886\Desktop\mongain\.node22-new;D:\Users\om0886\Desktop\mongain\.node22;%PATH% & set "EXPO_PUBLIC_API_URL=http://192.168.1.68:3000" & set "REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.68" & cd /d D:\Users\om0886\Desktop\mongain & npx expo start -c || (echo ERREUR SURVENUE & pause)"

echo Termine! Vous pouvez fermer cette fenetre.
