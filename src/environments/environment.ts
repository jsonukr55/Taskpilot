export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyAh7YkUCk5kHUwCWmuibwlmRZEVaL7Ot0o',
    authDomain: 'taskpilot-ad725.firebaseapp.com',
    projectId: 'taskpilot-ad725',
    storageBucket: 'taskpilot-ad725.firebasestorage.app',
    messagingSenderId: '554886543982',
    appId: '1:554886543982:web:f5db743cb17b5d244cc47f',
    measurementId: 'G-D6QZYCKK8S'
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
  // AI runs entirely through the Cloud Functions proxy; no keys in the frontend.
  functionsBaseUrl: 'https://us-central1-taskpilot-ad725.cloudfunctions.net',

  // Supabase (Postgres + Realtime + Auth). Fill these from your Supabase
  // project → Settings → API. The anon key is safe to ship in the client
  // (RLS enforces access); the service_role key must NEVER go here.
  supabase: {
    url:     'https://YOUR_PROJECT_REF.supabase.co',
    anonKey: 'YOUR_SUPABASE_ANON_KEY'
  }
};
