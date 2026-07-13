# TaskPilot — Setup Guide

## Prerequisites

- Node.js 20+
- Firebase CLI: `npm install -g firebase-tools`
- Angular CLI: `npm install -g @angular/cli`
- An Anthropic API key (for Claude AI)
- A Google account for Firebase

---

## 1. Firebase Project Setup

### Create Project
1. Go to https://console.firebase.google.com
2. Create a new project: **TaskPilot**
3. Enable Google Analytics (optional)

### Enable Authentication
1. Firebase Console → Authentication → Sign-in Method
2. Enable **Google** provider
3. Add your domain to authorized domains

### Create Firestore Database
1. Firebase Console → Firestore Database → Create database
2. Start in **production mode**
3. Choose a region (e.g., `us-central1`)

### Get Firebase Config
1. Project Settings → General → Your apps → Add Web App
2. Copy the config object

---

## 2. Environment Configuration

Edit `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  firebase: {
    apiKey:            'YOUR_API_KEY',
    authDomain:        'YOUR_PROJECT.firebaseapp.com',
    projectId:         'YOUR_PROJECT_ID',
    storageBucket:     'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId:             'YOUR_APP_ID'
  },
  google: {
    clientId:       'YOUR_GOOGLE_OAUTH_CLIENT_ID',
    calendarApiKey: 'YOUR_GOOGLE_CALENDAR_API_KEY',
    calendarScopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ]
  },
  microsoft: {
    clientId: 'YOUR_AZURE_APP_CLIENT_ID',
    tenantId: 'common',
    scopes:   ['Calendars.ReadWrite', 'User.Read']
  },
  functions: {
    baseUrl: 'http://localhost:5001/YOUR_PROJECT_ID/us-central1'
  }
};
```

---

## 3. Firebase Cloud Functions Setup

```bash
cd functions
npm install
```

Set the Anthropic API key as a Firebase secret:

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
# Enter your key when prompted
```

Or for local development, create `functions/.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 4. Google Calendar API

1. Google Cloud Console → Enable **Google Calendar API**
2. Create OAuth 2.0 credentials (Web application)
3. Add your domain as authorized JavaScript origin
4. Add `http://localhost:4200` for development
5. Copy Client ID to environment config

---

## 5. Microsoft Graph API (optional)

1. Azure Portal → App registrations → New registration
2. Redirect URI: `http://localhost:4200`
3. API Permissions → Add: `Calendars.ReadWrite`, `User.Read`
4. Copy Application (client) ID to environment config

---

## 6. Install & Run

```bash
# Install frontend dependencies
npm install

# Deploy Firestore rules and indexes
firebase deploy --only firestore

# Start Firebase emulators (separate terminal)
firebase emulators:start

# Start Angular dev server
ng serve
```

Open http://localhost:4200

---

## 7. Deploy to Production

```bash
# Build
ng build --configuration production

# Deploy hosting + functions + firestore rules
firebase deploy
```

---

## 8. Mobile (Capacitor)

```bash
# Sync web assets to native
npx cap sync

# Open in Android Studio
npx cap open android

# Open in Xcode
npx cap open ios
```

---

## Firestore Schema

```
users/
  {uid}/
    uid, email, displayName, photoURL
    preferences: { theme, timezone, workingHours, ... }
    stats: { totalTasks, completedTasks, currentStreak, ... }
    calendarIntegrations: [{ provider, connected, ... }]
    createdAt, updatedAt

tasks/
  {taskId}/
    userId, title, description
    status: 'todo' | 'in_progress' | 'completed' | 'cancelled'
    priority: 'low' | 'medium' | 'high' | 'urgent'
    startDate, dueDate, dueTime
    estimatedHours, actualHours
    categoryIds: string[]
    tags: string[]
    checklist: [{ id, text, completed, completedAt }]
    timeBlocks: [{ startTime, endTime, calendarEventId }]
    aiMetadata: { confidence, extractionMethod, schedulingSuggestion }
    createdAt, updatedAt

categories/
  {categoryId}/
    userId, name, description, icon, color
    parentId (null for root)
    keywords: string[]
    rules: { preferredHours, priorityBias, reminderMinutes }
    order, createdAt, updatedAt

schedules/
  {scheduleId}/
    userId, taskId
    startTime, endTime
    autoScheduled: boolean
    calendarEventId, provider
    hasConflict, conflictWith: string[]
    createdAt, updatedAt

insights/
  {insightId}/
    userId, type, title, body, icon
    severity: 'info' | 'warning' | 'critical'
    action: { label, command }
    read, dismissed
    createdAt, expiresAt
```

---

## Architecture Overview

```
src/app/
├── core/
│   ├── guards/          auth.guard.ts
│   └── services/
│       ├── auth.service.ts        Firebase Auth + Google Sign-In
│       ├── task.service.ts        Firestore CRUD + real-time sync
│       ├── category.service.ts    Category management + AI detection
│       ├── ai.service.ts          Claude API proxy calls
│       ├── scheduling.service.ts  Smart time-blocking
│       ├── calendar.service.ts    Google Calendar + Microsoft Graph
│       └── theme.service.ts       Dark/light mode
├── shared/
│   ├── models/          TypeScript interfaces (Task, Category, User...)
│   └── components/
│       ├── icon/         Inline SVG icon system
│       └── task-card/    Reusable task card
├── layout/
│   ├── shell/            Main app shell
│   ├── sidebar/          Navigation sidebar
│   └── topbar/           Top navigation bar
├── features/
│   ├── auth/login/       Google Sign-In page
│   ├── dashboard/        Overview + AI insights
│   ├── tasks/            List/board + AI creation modal
│   ├── tasks/task-detail/ Full task editor + checklist
│   ├── categories/        Category management + rules
│   ├── ai-chat/          Conversational AI interface
│   ├── calendar/         Week view + time blocks
│   └── analytics/        Charts + performance metrics
└── functions/src/index.ts  Firebase Cloud Functions (Claude API proxy)
```

## Key Design Decisions

- **No localStorage**: All user data in Firestore. Auth state managed by Firebase SDK.
- **No axios**: Angular HttpClient only for Google/Microsoft API calls.
- **AI via Cloud Functions**: API keys never exposed to the client.
- **Signal-based state**: Angular Signals for reactive UI without NgRx complexity.
- **Lazy-loaded routes**: All features code-split for performance.
- **Multi-tenant isolation**: Firestore rules enforce `userId == request.auth.uid`.
