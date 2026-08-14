const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src');

const replacements = [
    { regex: /color:\s*'(?:white|#fff|#ffffff)'/g, replace: "color: 'var(--text-primary)'" },
    { regex: /backgroundColor:\s*'#0f172a'/g, replace: "backgroundColor: 'var(--bg-primary)'" },
    { regex: /backgroundColor:\s*'#1e293b'/g, replace: "backgroundColor: 'var(--bg-card)'" },
    { regex: /backgroundColor:\s*'#334155'/g, replace: "backgroundColor: 'var(--bg-secondary)'" },
    { regex: /color:\s*'var\(--text-secondary\)'\s*\?\s*'#fff'/g, replace: "color: 'var(--text-primary)'" }
];

function processDir(directory) {
    const files = fs.readdirSync(directory);
    for (const file of files) {
        const fullPath = path.join(directory, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            processDir(fullPath);
        } else if (fullPath.endsWith('.tsx')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let modified = false;
            for (const { regex, replace } of replacements) {
                if (regex.test(content)) {
                    content = content.replace(regex, replace);
                    modified = true;
                }
            }
            if (modified) {
                fs.writeFileSync(fullPath, content);
                console.log(`Patched ${file}`);
            }
        }
    }
}

processDir(dir);
console.log("Patching complete!");
