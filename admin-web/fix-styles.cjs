const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

function fixFilesInDir(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            fixFilesInDir(fullPath);
        } else if (fullPath.endsWith('.tsx')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let originalContent = content;

            // Fix <select style={{ ... }}>
            content = content.replace(/(<select[^>]*style=\{\{\s*)/g, (match) => {
                if (match.includes("width: 'auto'")) return match;
                return match + "width: 'auto', ";
            });

            // Fix the search inputs container flex width if missed
            // Specifically looking for inputs with placeholder="Rechercher..."
            content = content.replace(/(placeholder="Rechercher[^"]*"[^>]*style=\{\{\s*)/g, (match) => {
                if (match.includes("width: 'auto'") || match.includes("width: '100%'")) return match;
                // If it doesn't have 100% or auto, we should probably set auto so it doesn't expand globally
                return match + "width: 'auto', flex: '1 1 200px', ";
            });

            // Also SupportCenter specifically has select with padding '6px 10px'
            // We want to ensure they flex nicely
            content = content.replace(/(<select[^>]*style=\{\{\s*width: 'auto',\s*)(padding)/g, (match, p1, p2) => {
                if (p1.includes("flex: ")) return match;
                return p1 + "flex: '1 1 150px', " + p2;
            });
            content = content.replace(/(<select[^>]*style=\{\{\s*width: 'auto',\s*)(background)/g, (match, p1, p2) => {
                if (p1.includes("flex: ")) return match;
                return p1 + "flex: '1 1 150px', " + p2;
            });

            if (content !== originalContent) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log('Fixed:', file);
            }
        }
    }
}

fixFilesInDir(srcDir);
console.log('All files processed.');
