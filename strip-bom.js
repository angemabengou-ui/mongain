const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            if (!file.includes('node_modules')) results = results.concat(walk(file));
        } else {
            if (file.endsWith('.tsx') || file.endsWith('.ts')) results.push(file);
        }
    });
    return results;
}

const files = walk('d:\\Users\\om0886\\Desktop\\mongain\\src\\app');
let fixedCount = 0;

files.forEach(f => {
    try {
        let text = fs.readFileSync(f, 'utf8');

        let changed = false;

        // Match the replacement character by its unicode escape
        if (text.startsWith('\uFFFD') || text.charCodeAt(0) === 65533) {
            text = text.substring(1);
            changed = true;
        }

        // Catch the exact Metro crash case "\ufffdimport"
        if (text.startsWith('\uFFFDimport')) {
            text = text.replace(/^\uFFFD/, '');
            changed = true;
        }

        if (changed) {
            fs.writeFileSync(f, text, 'utf8');
            fixedCount++;
            console.log('Stripped BOM/Garbage from:', f);
        }
    } catch (e) {
        console.error('Error:', f);
    }
});

console.log('Total files cleaned:', fixedCount);
