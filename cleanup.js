const fs = require('fs');

function walk(directory) {
    let results = [];
    const list = fs.readdirSync(directory);
    list.forEach(file => {
        let f = directory + '/' + file;
        const stat = fs.statSync(f);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(f));
        } else {
            if (f.endsWith('.tsx')) results.push(f);
        }
    });
    return results;
}

const dir = 'd:/Users/om0886/Desktop/mongain/src/app';
const allFiles = walk(dir);

let fixed = 0;
allFiles.forEach(f => {
    let text = fs.readFileSync(f, 'utf8');

    // Find all 'react-native-safe-area-context' imports
    const safeRegex = /import\s+\{[^{}]*\}\s+from\s+['"]react-native-safe-area-context['"];?(\r?\n)?/g;
    const matches = text.match(safeRegex);

    if (matches && matches.length > 1) {
        // Find the index of the first match
        let firstIndex = text.indexOf(matches[0]);
        let firstMatchLength = matches[0].length;

        let before = text.substring(0, firstIndex + firstMatchLength);
        let after = text.substring(firstIndex + firstMatchLength);

        // Remove ALL subsequent matches
        after = after.replace(safeRegex, '');

        // Let's also enforce that the single import contains SafeAreaView if it's there
        if (!before.includes("SafeAreaView")) {
            before = before.replace(/(import\s+\{)/, "$1 SafeAreaView,");
        }

        fs.writeFileSync(f, before + after);
        console.log('Cleaned file:', f);
        fixed++;
    }

    // Also clean up stray duplicate lines that the user showed
    let customText = fs.readFileSync(f, 'utf8');
    const repeatedUserLine = "import { useSafeAreaInsets } from 'react-native-safe-area-context';";
    const lineRegex = new RegExp(repeatedUserLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\s*", "g");
    const userMatches = customText.match(lineRegex);

    if (userMatches && userMatches.length > 1) {
        let idx = customText.indexOf(userMatches[0]);
        let bStr = customText.substring(0, idx + userMatches[0].length);
        let aStr = customText.substring(idx + userMatches[0].length).replace(lineRegex, '');
        fs.writeFileSync(f, bStr + aStr);
        console.log('Cleaned single-imports file:', f);
    }
});

console.log('Finished. Fixed: ' + fixed + ' files.');
