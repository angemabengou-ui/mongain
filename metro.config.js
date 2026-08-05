// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add support for parsing .cjs exported files (Needed for engine.io-client / socket.io-client on React Native)
config.resolver.sourceExts.push('cjs');

module.exports = config;
