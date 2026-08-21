const fs = require('fs');
const glob = require('glob');
const path = require('path');
const walkSync = (dir, filelist = []) => {
    fs.readdirSync(dir).forEach(file => {
        const dirFile = path.join(dir, file);
        if (fs.statSync(dirFile).isDirectory()) {
            filelist = walkSync(dirFile, filelist);
        } else if (dirFile.endsWith('.tsx')) {
            filelist.push(dirFile);
        }
    });
    return filelist;
};

let files = walkSync('./src/app');
files.forEach(f => {
    let content = fs.readFileSync(f, 'utf8');
    let changed = false;

    // Only inject insets in files that use KeyboardAvoidingView since those are the usual culprits
    if (!content.includes('KeyboardAvoidingView')) {
        return;
    }

    if (!content.includes('useSafeAreaInsets')) {
        if (content.includes('react-native-safe-area-context')) {
            content = content.replace('SafeAreaView', 'SafeAreaView, useSafeAreaInsets');
        } else {
            content = "import { useSafeAreaInsets } from 'react-native-safe-area-context';\n" + content;
        }
        changed = true;
    }

    if (!content.includes('const insets = useSafeAreaInsets()')) {
        content = content.replace(/(export default function \w+\([^)]*\)\s*\{)/, "$1\n    const insets = useSafeAreaInsets();");
        changed = true;
    }

    // Inject Spacer just before closing tags of KeyboardAvoidingView
    if (content.includes('</KeyboardAvoidingView>') && !content.includes('<View style={{ height: Math.max(insets.bottom, 20) }} />')) {
        content = content.replace(/<\/KeyboardAvoidingView>/g, '    {insets.bottom > 0 && <View style={{ height: Math.max(insets.bottom, 20) }} />}\n            </KeyboardAvoidingView>');
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(f, content);
        console.log("Patched", f);
    }
});
