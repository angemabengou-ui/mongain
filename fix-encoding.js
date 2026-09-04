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
    let text = fs.readFileSync(f, 'utf8');

    // Check if double mojibake exists
    if (text.includes('Ã©') || text.includes('Ã¨') || text.includes('Ã ') || text.includes('Ãª') || text.includes('Ã´') || text.includes('Ã®') || text.includes('Ã¯') || text.includes('Ã§')) {
        try {
            let buf = Buffer.from(text, 'latin1'); // Converts back to raw bytes
            let fixed = buf.toString('utf8');      // Parses the raw bytes cleanly as UTF-8
            fs.writeFileSync(f, fixed, 'utf8');
            fixedCount++;
            console.log('Fixed:', f);
        } catch (e) {
            console.error('Error fixing:', f, e);
        }
    }
});

console.log('Total fixed:', fixedCount);
