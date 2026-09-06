import { registerRootComponent } from 'expo';

import App from './App';

// Expo Web では process.versions が undefined になり、MusicKit JS が落ちるため先に潰す
if (typeof process !== 'undefined') {
  try {
    Object.defineProperty(process, 'versions', {
      value: null,
      writable: true,
      configurable: true,
    });
  } catch {
    try {
      process.versions = null;
    } catch {
      // ignore
    }
  }
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
