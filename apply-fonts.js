const fs = require('fs');
const path = require('path');

const DIRECTORY = path.join(__dirname, 'src/app');

function applyFontsRecursively(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            applyFontsRecursively(fullPath);
        } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let modified = false;

            // Regex 1: match standard fontWeights and add fontFamily before them
            // Example match: fontWeight: 'bold'
            // We only replace if there isn't already a fontFamily nearby.

            const regex = /fontWeight:\s*['"](bold|700|800|900|600)['"]/g;
            if (regex.test(content)) {
                content = content.replace(regex, (match, weight) => {
                    return `fontFamily: 'Satoshi-SemiBold', fontWeight: '${weight === '600' ? '600' : 'bold'}'`;
                });
                modified = true;
            }

            const regexRegular = /fontWeight:\s*['"](400|500|normal)['"]/g;
            if (regexRegular.test(content)) {
                content = content.replace(regexRegular, (match) => {
                    return `fontFamily: 'Satoshi-Regular'`;
                });
                modified = true;
            }

            // Cleanup potential duplicates like: fontFamily: '...', fontFamily: '...'
            const cleanupRegex = /fontFamily:\s*['"][^'"]+['"],\s*fontFamily:\s*['"][^'"]+['"]/g;
            if (cleanupRegex.test(content)) {
                content = content.replace(cleanupRegex, (match) => {
                    // Extract the first fontFamily and keep only that
                    const parts = match.split(',');
                    return parts[0];
                });
            }

            if (modified) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log(`Updated fonts in: ${fullPath}`);
            }
        }
    }
}

applyFontsRecursively(DIRECTORY);
