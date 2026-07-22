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
  // Server-side ops (membership: join/add/role) run through the Supabase
  // Edge Function `api`. AI routes will be added here when features.ai flips on.
  functionsBaseUrl: 'https://uffyycxwhldjqikcmopu.supabase.co/functions/v1/api',

  // Feature flags. AI is off until the Supabase Edge Functions (Groq proxy)
  // are deployed — every AI entry point shows "Coming soon" while false.
  features: {
    ai: false,
  },

  // Supabase (Postgres + Realtime + Auth). Fill these from your Supabase
  // project → Settings → API. The anon key is safe to ship in the client
  // (RLS enforces access); the service_role key must NEVER go here.
  supabase: {
    url:     'https://uffyycxwhldjqikcmopu.supabase.co',
    anonKey: 'sb_publishable_717vdxDYcgZThGHfISRoKA_IFHwWPEg'
  }
};
