const fs = require('fs');
const path = require('path');

const files = [
    'src/app/withdraw.tsx',
    'src/app/services/airtime.tsx',
    'src/app/services/seeg.tsx',
    'src/app/services/tv.tsx'
];

files.forEach(file => {
    const fullPath = path.join(__dirname, file);
    let content = fs.readFileSync(fullPath, 'utf8');

    // Fix SafeAreaView & Ionicons if still malformed
    content = content.replace(/import\s*{\s*([^}]*SafeAreaView[^}]*)\s*}\s*from\s*['"]@expo\/vector-icons['"];?/, (match, p1) => {
        let others = p1.replace(/SafeAreaView,?\s*/, '').trim();
        if (others.endsWith(',')) others = others.slice(0, -1);
        if (!others) return `import { SafeAreaView } from 'react-native-safe-area-context';`;
        return `import { ${others} } from '@expo/vector-icons';\nimport { SafeAreaView } from 'react-native-safe-area-context';`;
    });

    // Fix useFocusEffect
    if (!content.includes('useFocusEffect')) {
        content = content.replace(/import\s*{\s*useRouter\s*}\s*from\s*['"]expo-router['"];?/, `import { useRouter, useFocusEffect } from 'expo-router';`);
    }

    // Fix useCallback
    if (!content.includes('useCallback')) {
        content = content.replace(/import\s*React\s*,\s*{\s*useState\s*}\s*from\s*['"]react['"];?/, `import React, { useState, useCallback } from 'react';`);
    }

    // Fix apiGetBalance for withdraw
    if (file === 'src/app/withdraw.tsx' && !content.includes('apiGetBalance')) {
        content = content.replace(/import\s*{\s*useAuth\s*}\s*from\s*['"]\.\.\/context\/AuthContext['"];?/, `import { useAuth } from '../context/AuthContext';\nimport { apiGetBalance } from '../services/api';`);
    }

    // Fix apiGetBalance for services
    if (file.includes('services/') && !content.includes('apiGetBalance')) {
        if (content.includes('getToken')) {
            content = content.replace(/import\s*{\s*BASE_URL\s*,\s*getToken\s*}\s*from\s*['"]\.\.\/\.\.\/services\/api['"];?/, `import { BASE_URL, getToken, apiGetBalance } from '../../services/api';`);
        } else {
            content = content.replace(/import\s*{\s*useAuth\s*}\s*from\s*['"]\.\.\/\.\.\/context\/AuthContext['"];?/, `import { useAuth } from '../../context/AuthContext';\nimport { BASE_URL, getToken, apiGetBalance } from '../../services/api';`);
        }
    }

    fs.writeFileSync(fullPath, content);
    console.log(`Patched ${file}`);
});
