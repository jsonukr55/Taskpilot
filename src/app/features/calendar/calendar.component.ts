import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SchedulingService } from '@core/services/scheduling.service';
import { CalendarService, CalendarEvent } from '@core/services/calendar.service';
import { TaskService } from '@core/services/task.service';
import { NoteService } from '@core/services/note.service';
import { AuthService } from '@core/services/auth.service';
import { WorkingCalendarService } from '@core/services/working-calendar.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { Task } from '@shared/models/task.model';
import { Note } from '@shared/models/note.model';
import { birthdaysOn } from '@shared/models/birthday.model';

type CalView = 'week' | 'month' | 'day';

@Component({
  selector:   'tp-calendar',
  standalone: true,
  imports:    [DatePipe, RouterLink, IconComponent],
  templateUrl: './calendar.component.html',
  styleUrl:    './calendar.component.scss'
})
export class CalendarComponent implements OnInit, OnDestroy {
  private readonly scheduling  = inject(SchedulingService);
  private readonly calendar    = inject(CalendarService);
  readonly tasks               = inject(TaskService);
  private readonly noteService = inject(NoteService);
  private readonly auth        = inject(AuthService);
  private readonly workCal     = inject(WorkingCalendarService);

  // Hover preview for a note chip
  readonly hoverNote = signal<{ title: string; preview: string; x: number; y: number } | null>(null);

  readonly view          = signal<CalView>('week');
  readonly currentDate   = signal(new Date());
  readonly externalEvents = signal<CalendarEvent[]>([]);
  readonly isLoading     = signal(false);

  readonly weekDays = computed(() => {
    const d    = this.currentDate();
    const mon  = new Date(d);
    mon.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(mon);
      day.setDate(mon.getDate() + i);
      return day;
    });
  });

  readonly hours = Array.from({ length: 16 }, (_, i) => i + 7); // 7AM–10PM

  nowLineTop(): number {
    const now  = new Date();
    const mins = (now.getHours() - 7) * 60 + now.getMinutes();
    return Math.max(0, Math.min(100, mins / (16 * 60) * 100));
  }

  readonly calendarDays = computed(() => {
    const days     = this.weekDays();
    const blocks   = this.scheduling.schedules();
    const allTasks = this.tasks.tasks();
    const allNotes = this.noteService.notes();
    return days.map(day => {
      const start   = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const end     = new Date(start.getTime() + 86_400_000);
      const dateStr = start.toDateString();
      const key     = this.dateKey(day);
      return {
        date:      day,
        holiday:   this.workCal.holidayName(key),
        birthdays: birthdaysOn(day.getMonth() + 1, day.getDate()),
        blocks: blocks.filter(b => {
          const t = b.startTime.toDate();
          return t >= start && t < end;
        }),
        tasks: allTasks.filter(t => {
          if (t.status === 'completed') return false;
          const due   = t.dueDate?.toDate();
          const sDate = t.startDate?.toDate();
          return (due && due.toDateString() === dateStr) ||
                 (sDate && sDate.toDateString() === dateStr);
        }),
        // Notes are placed on the day they were added.
        notes: allNotes.filter(n => n.createdAt?.toDate?.().toDateString() === dateStr)
      };
    });
  });

  readonly hasAnyNotes    = computed(() => this.calendarDays().some(d => d.notes.length > 0));
  readonly hasAnyHoliday  = computed(() => this.calendarDays().some(d => !!d.holiday));
  readonly hasAnyBirthday = computed(() => this.calendarDays().some(d => d.birthdays.length > 0));

  /** Local 'YYYY-MM-DD' for a week-grid day (matches the holiday date keys). */
  private dateKey(day: Date): string {
    const m = String(day.getMonth() + 1).padStart(2, '0');
    const d = String(day.getDate()).padStart(2, '0');
    return `${day.getFullYear()}-${m}-${d}`;
  }

  ngOnInit(): void {
    this.noteService.openPersonalNotes();
    this.loadExternalEvents();
  }
  ngOnDestroy(): void {
    this.noteService.closeGroupNotes();
  }

  showNotePreview(ev: MouseEvent, note: Note): void {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.hoverNote.set({
      title:   note.title || 'Untitled',
      preview: this.notePreview(note),
      x:       r.left,
      y:       r.bottom + 6
    });
  }

  private notePreview(note: Note): string {
    const text = (note.blocks ?? [])
      .filter(b => b.type !== 'divider')
      .map(b => { const t = document.createElement('div'); t.innerHTML = b.html || ''; return (t.textContent ?? '').trim(); })
      .filter(Boolean)
      .slice(0, 4)
      .join(' · ');
    return text.slice(0, 180) || 'Empty note';
  }

  private async loadExternalEvents(): Promise<void> {
    this.isLoading.set(true);
    try {
      const days    = this.weekDays();
      const timeMin = days[0];
      const timeMax = new Date(days[6].getTime() + 86_400_000);
      const events  = await this.calendar.getAllEvents(timeMin, timeMax);
      this.externalEvents.set(events);
    } catch { /* not connected */ } finally {
      this.isLoading.set(false);
    }
  }

  navigate(direction: -1 | 1): void {
    const d = new Date(this.currentDate());
    d.setDate(d.getDate() + direction * 7);
    this.currentDate.set(d);
    this.loadExternalEvents();
  }

  goToday(): void {
    this.currentDate.set(new Date());
    this.loadExternalEvents();
  }

  isToday(d: Date): boolean {
    const t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }

  blockStyle(block: { startTime: { toDate: () => Date }; endTime: { toDate: () => Date } }): Record<string, string> {
    const start = block.startTime.toDate();
    const end   = block.endTime.toDate();
    const top   = ((start.getHours() - 7) * 60 + start.getMinutes()) / (16 * 60) * 100;
    const height = (end.getTime() - start.getTime()) / (16 * 60 * 60 * 1000) * 100;
    return {
      top:    `${top}%`,
      height: `${Math.max(height, 1.5)}%`,
      left:   '4px',
      right:  '4px'
    };
  }

  getTask(taskId: string) {
    return this.tasks.getTaskById(taskId);
  }

  taskStyle(task: Task): Record<string, string> {
    let hour = 9, minute = 0;
    if (task.dueTime) {
      const [h, m] = task.dueTime.split(':').map(Number);
      hour = h; minute = m;
    }
    const top = Math.max(0, ((hour - 7) * 60 + minute) / (16 * 60) * 100);
    return { top: `${top}%`, height: '2.5%', left: '4px', right: '4px' };
  }
}
