// CRITICAL: This polyfill MUST be the very first import in the entire bundle.
// On Android (Hermes engine), socket.io-client uses the Web Crypto API (crypto.getRandomValues)
// at module evaluation time. In a production APK, Metro resolves dependency modules in
// dependency-graph order — NOT file-order — so the polyfill placed in _layout.tsx (which is
// a leaf of the dependency graph) could be evaluated AFTER AuthContext → socket.io-client.
// When that happens, the Hermes engine throws a "crypto.getRandomValues is not a function"
// error at module-evaluation time, before React has mounted anything — the ErrorBoundary
// in _layout.tsx cannot intercept it, leaving a permanent white screen with no error message.
// By placing this import here (the bundle entrypoint), we guarantee it runs first, always.
import 'react-native-get-random-values';

// Standard expo-router entrypoint (replaces the "main": "expo-router/entry" in package.json)
import 'expo-router/entry';
