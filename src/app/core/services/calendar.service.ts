import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { ScheduledBlock } from '@shared/models/schedule.model';
import { Task } from '@shared/models/task.model';

// ============================================================
// CalendarService — Google Calendar + Microsoft Graph API
// Uses native HttpClient only (no external HTTP libraries)
// ============================================================

export interface CalendarEvent {
  id:          string;
  title:       string;
  description?: string;
  startTime:   Date;
  endTime:     Date;
  allDay:      boolean;
  provider:    'google' | 'microsoft';
  taskId?:     string;
}

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private googleAccessToken?: string;
  private msAccessToken?:     string;

  // ============================================================
  // GOOGLE CALENDAR
  // ============================================================

  private get googleHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Authorization': `Bearer ${this.googleAccessToken ?? ''}`,
      'Content-Type':  'application/json'
    });
  }

  async connectGoogle(accessToken: string): Promise<void> {
    this.googleAccessToken = accessToken;
    await this.auth.updatePreferences({});
  }

  async getGoogleEvents(
    calendarId: string,
    timeMin:    Date,
    timeMax:    Date
  ): Promise<CalendarEvent[]> {
    if (!this.googleAccessToken) return [];

    const params = new HttpParams()
      .set('timeMin',     timeMin.toISOString())
      .set('timeMax',     timeMax.toISOString())
      .set('singleEvents', 'true')
      .set('orderBy',     'startTime')
      .set('maxResults',  '250');

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    const response = await firstValueFrom(
      this.http.get<{ items: GoogleCalendarEvent[] }>(url, {
        headers: this.googleHeaders,
        params
      })
    );

    return (response.items ?? []).map(e => this.mapGoogleEvent(e));
  }

  async createGoogleEvent(
    calendarId: string,
    task:       Task,
    block:      ScheduledBlock
  ): Promise<string> {
    if (!this.googleAccessToken) throw new Error('Google not connected');

    const event = {
      summary:     task.title,
      description: task.description ?? '',
      start: {
        dateTime: block.startTime.toDate().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      end: {
        dateTime: block.endTime.toDate().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      extendedProperties: {
        private: { taskpilotTaskId: task.id }
      }
    };

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const res = await firstValueFrom(
      this.http.post<{ id: string }>(url, event, { headers: this.googleHeaders })
    );
    return res.id;
  }

  async updateGoogleEvent(
    calendarId: string,
    eventId:    string,
    changes:    { startTime?: Date; endTime?: Date; title?: string }
  ): Promise<void> {
    if (!this.googleAccessToken) return;

    const patch: Record<string, unknown> = {};
    if (changes.title)     patch['summary'] = changes.title;
    if (changes.startTime) patch['start']   = { dateTime: changes.startTime.toISOString() };
    if (changes.endTime)   patch['end']     = { dateTime: changes.endTime.toISOString() };

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`;
    await firstValueFrom(this.http.patch(url, patch, { headers: this.googleHeaders }));
  }

  async deleteGoogleEvent(calendarId: string, eventId: string): Promise<void> {
    if (!this.googleAccessToken) return;
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`;
    await firstValueFrom(this.http.delete(url, { headers: this.googleHeaders }));
  }

  // ============================================================
  // MICROSOFT GRAPH (Outlook)
  // ============================================================

  private get msHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Authorization': `Bearer ${this.msAccessToken ?? ''}`,
      'Content-Type':  'application/json'
    });
  }

  async connectMicrosoft(accessToken: string): Promise<void> {
    this.msAccessToken = accessToken;
  }

  async getMicrosoftEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    if (!this.msAccessToken) return [];

    const params = new HttpParams()
      .set('startDateTime', timeMin.toISOString())
      .set('endDateTime',   timeMax.toISOString())
      .set('$orderby',      'start/dateTime')
      .set('$top',          '250');

    const url = 'https://graph.microsoft.com/v1.0/me/calendarView';
    const response = await firstValueFrom(
      this.http.get<{ value: MsCalendarEvent[] }>(url, { headers: this.msHeaders, params })
    );

    return (response.value ?? []).map(e => this.mapMsEvent(e));
  }

  async createMicrosoftEvent(task: Task, block: ScheduledBlock): Promise<string> {
    if (!this.msAccessToken) throw new Error('Microsoft not connected');

    const event = {
      subject:      task.title,
      body:         { contentType: 'Text', content: task.description ?? '' },
      start:        { dateTime: block.startTime.toDate().toISOString(), timeZone: 'UTC' },
      end:          { dateTime: block.endTime.toDate().toISOString(),   timeZone: 'UTC' },
      singleValueExtendedProperties: [{
        id:    'String {00020329-0000-0000-C000-000000000046} Name taskpilotTaskId',
        value: task.id
      }]
    };

    const url = 'https://graph.microsoft.com/v1.0/me/events';
    const res = await firstValueFrom(
      this.http.post<{ id: string }>(url, event, { headers: this.msHeaders })
    );
    return res.id;
  }

  async deleteMicrosoftEvent(eventId: string): Promise<void> {
    if (!this.msAccessToken) return;
    await firstValueFrom(
      this.http.delete(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, { headers: this.msHeaders })
    );
  }

  // ============================================================
  // Unified API
  // ============================================================

  async getAllEvents(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    const [google, microsoft] = await Promise.allSettled([
      this.getGoogleEvents('primary', timeMin, timeMax),
      this.getMicrosoftEvents(timeMin, timeMax)
    ]);

    return [
      ...(google.status === 'fulfilled' ? google.value : []),
      ...(microsoft.status === 'fulfilled' ? microsoft.value : [])
    ];
  }

  // ---- Mappers ----

  private mapGoogleEvent(e: GoogleCalendarEvent): CalendarEvent {
    const allDay = !!e.start?.date;
    return {
      id:          e.id,
      title:       e.summary ?? '(No title)',
      description: e.description,
      startTime:   new Date(e.start?.dateTime ?? e.start?.date ?? ''),
      endTime:     new Date(e.end?.dateTime   ?? e.end?.date   ?? ''),
      allDay,
      provider:    'google',
      taskId:      e.extendedProperties?.private?.['taskpilotTaskId']
    };
  }

  private mapMsEvent(e: MsCalendarEvent): CalendarEvent {
    return {
      id:        e.id,
      title:     e.subject ?? '(No title)',
      startTime: new Date(e.start?.dateTime ?? ''),
      endTime:   new Date(e.end?.dateTime   ?? ''),
      allDay:    e.isAllDay ?? false,
      provider:  'microsoft'
    };
  }
}

// ---- Google Calendar API types ----
interface GoogleCalendarEvent {
  id:          string;
  summary?:    string;
  description?: string;
  start?:      { dateTime?: string; date?: string };
  end?:        { dateTime?: string; date?: string };
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

// ---- Microsoft Graph API types ----
interface MsCalendarEvent {
  id:       string;
  subject?: string;
  start?:   { dateTime?: string };
  end?:     { dateTime?: string };
  isAllDay?: boolean;
}
