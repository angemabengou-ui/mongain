// Converti depuis app.json (config statique) pour rendre android.usesCleartextTraffic
// conditionnel : nécessaire uniquement en développement local (voir src/services/api.ts,
// BASE_URL — connexion à un serveur backend en http:// sur le réseau local ou l'émulateur),
// jamais en production où le backend réel est toujours en https://. EAS_BUILD_PROFILE
// n'est défini que par un build EAS (`eas build --profile <nom>`) ; absent en local
// (`expo start`), on reste donc dans le cas développement par défaut.
const buildProfile = process.env.EAS_BUILD_PROFILE;
const isDevBuild = !buildProfile || buildProfile === 'development';

const { withAndroidStyles, AndroidConfig } = require('@expo/config-plugins');

// Écran blanc reproductible UNIQUEMENT quand le thème SYSTÈME est en mode clair (jamais en
// sombre), constaté sur deux téléphones différents (Tecno Camon 40, Samsung S24 Ultra) — donc
// pas un bug JS (sinon indépendant du thème système) ni un problème de build APK isolé.
// android.backgroundColor (plus bas) corrige déjà android:windowBackground, et on a vérifié
// que sa valeur résolue est identique en clair/sombre (values-night/colors.xml généré est
// vide, donc repli sur values/colors.xml dans les deux cas) — ce fond-là n'explique donc PAS
// la différence observée.
//
// `AppTheme` hérite de `Theme.AppCompat.DayNight(.NoActionBar)` (confirmé dans le
// styles.xml généré) : cette famille de thèmes bascule AUTOMATIQUEMENT entre sa variante
// Light et sa variante Dark selon le mode système, tant qu'aucun `AppCompatDelegate` ne le
// force autrement. Cette bascule ne touche pas que `windowBackground` (qu'on contrôle déjà) :
// elle définit aussi `android:colorBackground`, un attribut de thème DISTINCT, jamais
// surchargé jusqu'ici — sa valeur héritée est BLANCHE dans la variante Light, sombre dans la
// variante Dark. Avec `newArchEnabled`/`edgeToEdgeEnabled` (RN 0.86, imposés, voir
// android/gradle.properties généré), la surface Fabric peut peindre son tout premier frame
// (avant que le JS n'ait fini d'évaluer et de committer) avec cette couleur de thème plutôt
// qu'avec `windowBackground` — un blanc en clair, invisible en sombre puisque déjà sombre par
// défaut. On fixe donc aussi cet attribut, explicitement, à la même teinte que le reste.
function withColorBackgroundFix(config) {
  return withAndroidStyles(config, (config) => {
    config.modResults = AndroidConfig.Styles.setStylesItem({
      xml: config.modResults,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      item: { $: { name: 'android:colorBackground' }, _: '@color/activityBackground' },
      add: true,
    });
    return config;
  });
}

module.exports = () => ({
  expo: {
    name: 'Mongain',
    slug: 'mongain',
    version: '1.0.0',
    sdkVersion: '57.0.0',
    orientation: 'portrait',
    icon: './assets/images/logo-v2.png',
    scheme: 'mongain',
    userInterfaceStyle: 'automatic',
    ios: {
      icon: './assets/images/logo-v2.png',
      bundleIdentifier: 'com.mongain.superapp',
    },
    android: {
      usesCleartextTraffic: isDevBuild,
      googleServicesFile: './google-services.json',
      package: 'com.mongain.superapp',
      // Corrige le "flash blanc" au démarrage : le thème Android actif une fois le splash
      // natif écarté (AppTheme, généré par expo-splash-screen sans couleur de fond propre)
      // hérite du blanc par défaut d'AppCompat — visible dès que l'OS quitte le splash,
      // AVANT même que React n'ait eu la moindre chance de dessiner quoi que ce soit.
      // Contrairement au splash lui-même (contrôlé par JS via SplashScreen.hideAsync), ce
      // fond est purement natif : aucun filet de sécurité côté JS ne peut l'empêcher tant
      // que cette couleur n'est pas fixée dans le thème natif. Le plugin expo-system-ui lit
      // ce champ pour poser android:windowBackground sur AppTheme — même teinte que le
      // splash et le fond réel de l'appli, pour qu'un JS lent ou en échec révèle du sombre
      // cohérent avec la marque plutôt qu'un blanc brutal.
      backgroundColor: '#0a0a0f',
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
        foregroundImage: './assets/images/logo-v2.png',
      },
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    // expo-updates est une dépendance du projet (mises à jour OTA) mais AUCUNE mise à jour
    // n'a jamais été publiée (`eas update`) — sans ce champ, un build EAS lié à un projet
    // (extra.eas.projectId, ci-dessous) active ce module par défaut avec une vérification
    // réseau AU DÉMARRAGE, avant même le premier rendu JS. Contrairement à Expo Go (qui
    // n'active jamais ce module), un vrai build APK peut donc rester bloqué sur un écran
    // blanc en attendant une réponse qui n'arrivera jamais vers un canal qui n'existe pas —
    // exactement le symptôme observé (fonctionne dans Expo Go, jamais dans l'APK, sur
    // plusieurs téléphones). Désactivé tant que les mises à jour OTA ne sont pas utilisées.
    updates: {
      enabled: false,
    },
    plugins: [
      'expo-router',
      // Explicite (pas seulement le champ `updates` ci-dessus) : garantit que le plugin de
      // config d'expo-updates s'exécute bien pendant le prebuild EAS et écrit correctement
      // `enabled: false` dans le manifeste natif, plutôt que de compter sur une éventuelle
      // auto-application implicite.
      'expo-updates',
      [
        'expo-splash-screen',
        {
          backgroundColor: '#0a0a0f',
          image: './assets/images/logo-v2.png',
          imageWidth: 200,
        },
      ],
      'expo-secure-store',
      // Manquant jusqu'ici : aucune fonctionnalité JS ne dépend de ce plugin (la création du
      // canal Android et la récupération du token se font au runtime, voir AuthContext.tsx),
      // MAIS la doc officielle SDK 57 (docs.expo.dev/versions/v57.0.0/sdk/notifications) est
      // explicite — ce plugin est "required" pour EAS Build sur les deux plateformes, et sans
      // lui l'entitlement iOS `aps-environment` n'est écrit dans AUCUN build (ni dev ni
      // release) : Xcode ne fait que PROMOUVOIR 'development' en 'production' à l'archivage,
      // il ne peut rien promouvoir si la clé n'existe pas du tout. Résultat concret sur iOS :
      // push totalement muet/absent, indépendamment des identifiants APNs côté EAS (l'autre
      // moitié de l'enquête) — un bug purement côté build client, jamais visible en JS. Sur
      // Android ce plugin ne fait qu'ajouter icône/couleur de notification (cosmétique, pas
      // encore configuré ici faute d'asset dédié) ; la permission POST_NOTIFICATIONS, elle,
      // vient déjà automatiquement du AndroidManifest.xml propre au module expo-notifications
      // (fusionné par Gradle via l'autolinking), pas de ce plugin — donc son absence n'explique
      // PAS un silence sur Android, seulement sur iOS.
      'expo-notifications',
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
      withColorBackgroundFix,
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: false,
    },
    extra: {
      router: {},
      owner: 'ange1994',
      eas: {
        projectId: '62c3cfa7-ad7e-4ec8-8c22-df55b5c34464',
      },
    },
  },
});
