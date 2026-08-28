// Converti depuis app.json (config statique) pour rendre android.usesCleartextTraffic
// conditionnel : nécessaire uniquement en développement local (voir src/services/api.ts,
// BASE_URL — connexion à un serveur backend en http:// sur le réseau local ou l'émulateur),
// jamais en production où le backend réel est toujours en https://. EAS_BUILD_PROFILE
// n'est défini que par un build EAS (`eas build --profile <nom>`) ; absent en local
// (`expo start`), on reste donc dans le cas développement par défaut.
const buildProfile = process.env.EAS_BUILD_PROFILE;
const isDevBuild = !buildProfile || buildProfile === 'development';

module.exports = () => ({
  expo: {
    name: 'Mongain',
    slug: 'mongain',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'mongain',
    userInterfaceStyle: 'automatic',
    ios: {
      icon: './assets/expo.icon',
      bundleIdentifier: 'com.mongain.superapp',
    },
    android: {
      usesCleartextTraffic: isDevBuild,
      googleServicesFile: './google-services.json',
      package: 'com.mongain.superapp',
      permissions: [
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_CONTACTS',
        'android.permission.WRITE_CONTACTS',
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
      ],
      adaptiveIcon: {
        backgroundColor: '#130925',
        foregroundImage: './assets/images/icon.png',
      },
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#0a0a0f',
          image: './assets/images/splash-icon.png',
          imageWidth: 76,
        },
      ],
      'expo-secure-store',
      [
        'expo-camera',
        {
          cameraPermission: 'Allow Mongain to access your camera to scan QR codes for payments.',
        },
      ],
      [
        'expo-contacts',
        {
          contactsPermission: 'Allow Mongain to access your contacts to easily select a receiver.',
        },
      ],
      [
        'expo-local-authentication',
        {
          faceIDPermission: 'Allow Mongain to use Face ID for securing your transactions.',
        },
      ],
      'expo-asset',
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: false,
    },
    extra: {
      router: {},
      eas: {
        projectId: '4edb24ae-d377-4d55-bc51-5c46a2dff70b',
      },
    },
  },
});
