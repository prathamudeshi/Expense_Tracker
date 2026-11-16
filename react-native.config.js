/**
 * React Native CLI configuration. Android only - this app has no iOS target.
 *
 * `expo` ships as a dependency of the RN 0.87 template purely for its JS dev
 * tooling (Metro config, LogBox). We use no Expo *native* modules.
 *
 * Its own react-native.config.js tries to detect whether Expo modules are set
 * up by looking for `useExpoModules` in android/settings.gradle, but it builds
 * that path from `findProjectRootSync()`, which in expo-modules-autolinking 57
 * returns the path to package.json rather than the project directory. The check
 * therefore always misses, Expo assumes this is a managed app and asks to be
 * autolinked into Gradle - which then fails with:
 *
 *   Plugin with id 'expo-module-gradle-plugin' not found
 *
 * Opting `expo` out of native autolinking is the documented way to say
 * "JS tooling only, please".
 */
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: null,
      },
    },
  },
};
