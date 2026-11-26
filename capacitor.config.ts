import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.edu.suh.express',
  appName: 'Sreenidhi Express',
  webDir: 'dist',
  server: {
    androidScheme: 'https', // origin = https://localhost  (allowed by server/security.js buildCorsOptions)
    cleartext: false,       // never allow http:// to the API; set VITE_API_BASE_URL to your https URL
  },
  android: { allowMixedContent: false },
  plugins: {
    StatusBar: { style: 'DARK', backgroundColor: '#050814', overlaysWebView: false },
    SplashScreen: { launchShowDuration: 1200, backgroundColor: '#050814', showSpinner: false },
    LocalNotifications: { smallIcon: 'ic_stat_transit', iconColor: '#4f46e5', sound: 'default' },
  },
};

export default config;
