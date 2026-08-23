// Manual mock for `@expo/vector-icons`.
//
// The real package pulls in `expo-font` -> `expo-asset`, which isn't installed in this
// project's node_modules (it's listed as a dependency of `expo` but missing on disk), so
// importing any icon set blows up module resolution in Jest. Icons are purely decorative
// in the screens under test, so we swap every icon set (Ionicons, etc.) for a trivial
// `Text`-based stand-in that renders the icon `name` — good enough for snapshot-free
// render/interaction tests without needing font loading at all.
const React = require('react');
const { Text } = require('react-native');

function createIconComponent(setName) {
    function Icon(props) {
        return React.createElement(Text, props, props && props.name ? props.name : setName);
    }
    Icon.displayName = setName;
    return Icon;
}

module.exports = new Proxy(
    {},
    {
        get(target, prop) {
            if (prop === '__esModule') return true;
            if (prop === 'default') return createIconComponent('Icon');
            if (typeof prop !== 'string') return undefined;
            return createIconComponent(prop);
        },
    }
);
