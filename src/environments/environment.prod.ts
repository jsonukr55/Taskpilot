export const environment = {
  production: true,
  firebase: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
    measurementId: 'YOUR_MEASUREMENT_ID'
  },
  google: {
    clientId: 'YOUR_GOOGLE_CLIENT_ID',
    calendarApiKey: 'YOUR_GOOGLE_CALENDAR_API_KEY',
    calendarScopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ]
  },
  microsoft: {
    clientId: 'YOUR_MICROSOFT_CLIENT_ID',
    tenantId: 'common',
    scopes: ['Calendars.ReadWrite', 'User.Read']
  },
  functionsBaseUrl: 'https://us-central1-taskpilot-ad725.cloudfunctions.net'
};
