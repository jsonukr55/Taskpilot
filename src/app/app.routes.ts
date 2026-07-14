import { Routes } from '@angular/router';
import { authGuard, publicGuard } from '@core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'auth',
    canActivate: [publicGuard],
    children: [
      {
        path: 'login',
        loadComponent: () => import('./features/auth/login/login.component').then(m => m.LoginComponent)
      },
      { path: '', redirectTo: 'login', pathMatch: 'full' }
    ]
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell/shell.component').then(m => m.ShellComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
        title: 'Dashboard — TaskPilot'
      },
      {
        path: 'tasks',
        loadComponent: () => import('./features/tasks/tasks.component').then(m => m.TasksComponent),
        title: 'Tasks — TaskPilot'
      },
      {
        path: 'tasks/:id',
        loadComponent: () => import('./features/tasks/task-detail/task-detail.component').then(m => m.TaskDetailComponent),
        title: 'Task Detail — TaskPilot'
      },
      {
        path: 'daily',
        loadComponent: () => import('./features/daily-report/daily-report.component').then(m => m.DailyReportComponent),
        title: 'Daily Report — TaskPilot'
      },
      {
        path: 'calendar',
        loadComponent: () => import('./features/calendar/calendar.component').then(m => m.CalendarComponent),
        title: 'Calendar — TaskPilot'
      },
      {
        path: 'categories',
        loadComponent: () => import('./features/categories/categories.component').then(m => m.CategoriesComponent),
        title: 'Categories — TaskPilot'
      },
      {
        path: 'notes',
        loadComponent: () => import('./features/notes/notes.component').then(m => m.NotesComponent),
        title: 'Notes — TaskPilot'
      },
      {
        path: 'notes/:noteId',
        loadComponent: () => import('./features/notes/note-editor/note-editor.component').then(m => m.NoteEditorComponent),
        title: 'Note — TaskPilot'
      },
      {
        path: 'groups',
        loadComponent: () => import('./features/groups/groups.component').then(m => m.GroupsComponent),
        title: 'Groups — TaskPilot'
      },
      {
        path: 'groups/:groupId',
        loadComponent: () => import('./features/groups/group-detail/group-detail.component').then(m => m.GroupDetailComponent),
        title: 'Group — TaskPilot'
      },
      {
        path: 'groups/:groupId/notes/:noteId',
        loadComponent: () => import('./features/notes/note-editor/note-editor.component').then(m => m.NoteEditorComponent),
        title: 'Note — TaskPilot'
      },
      {
        path: 'join/:token',
        loadComponent: () => import('./features/groups/join-group/join-group.component').then(m => m.JoinGroupComponent),
        title: 'Join group — TaskPilot'
      },
      {
        path: 'ai-chat',
        loadComponent: () => import('./features/ai-chat/ai-chat.component').then(m => m.AiChatComponent),
        title: 'AI Assistant — TaskPilot'
      },
      {
        path: 'analytics',
        loadComponent: () => import('./features/analytics/analytics.component').then(m => m.AnalyticsComponent),
        title: 'Analytics — TaskPilot'
      },
      {
        path: 'whats-new',
        loadComponent: () => import('./features/whats-new/whats-new.component').then(m => m.WhatsNewComponent),
        title: "What's New — TaskPilot"
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  },
  { path: '**', redirectTo: '/dashboard' }
];
