import { Injectable, inject, signal } from '@angular/core';
import { Firestore, doc, onSnapshot } from '@angular/fire/firestore';
import { WorkingCalendar, Holiday } from '@shared/models/daily-report.model';

// ============================================================
// WorkingCalendarService — the "what day is it" engine.
//
// All dates are handled as 'YYYY-MM-DD' calendar strings and anchored to IST,
// NOT the browser's local clock (the classic timezone bug). "Today" is computed
// via Intl in Asia/Kolkata; weekday math treats the string as a UTC calendar
// date so it never drifts across timezones.
//
// Only WEEKENDS + MANDATORY holidays drive this engine. Restricted holidays are
// per-employee leave handled manually by the manager (see docs/ROADMAP.md).
// ============================================================

/** ASHVAD mandatory holidays 2026 — company-wide days off. Used as the default
 *  seed until (and unless) a `settings/workingCalendar` doc overrides it. */
export const MANDATORY_HOLIDAYS_2026: Holiday[] = [
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-03-04', name: 'Holi' },
  { date: '2026-03-21', name: 'Eid al-Fitr' },
  { date: '2026-05-27', name: 'Eid al-Adha' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-08-28', name: 'Raksha Bandhan' },
  { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti' },
  { date: '2026-10-21', name: 'Dussehra' },
  { date: '2026-11-08', name: 'Deepawali' },
  { date: '2026-11-09', name: 'Deepawali' },
  { date: '2026-11-10', name: 'Govardhan Puja' },
  { date: '2026-11-11', name: 'Bhai Dooj' }
];

const DEFAULT_CALENDAR: WorkingCalendar = {
  weekends: [0, 6],            // Sunday, Saturday
  holidays: MANDATORY_HOLIDAYS_2026,
  timezone: 'Asia/Kolkata'
};

@Injectable({ providedIn: 'root' })
export class WorkingCalendarService {
  private readonly firestore = inject(Firestore);

  /** Live calendar config. Starts from the built-in seed and is overwritten if a
   *  `settings/workingCalendar` doc exists. */
  readonly calendar = signal<WorkingCalendar>(DEFAULT_CALENDAR);

  private unsubscribe?: () => void;

  constructor() {
    // Read-only subscription; falls back to the seed when the doc is absent.
    this.unsubscribe = onSnapshot(
      doc(this.firestore, 'settings', 'workingCalendar'),
      snap => {
        if (snap.exists()) {
          const data = snap.data() as Partial<WorkingCalendar>;
          this.calendar.set({
            weekends: data.weekends ?? DEFAULT_CALENDAR.weekends,
            holidays: data.holidays ?? DEFAULT_CALENDAR.holidays,
            timezone: data.timezone ?? DEFAULT_CALENDAR.timezone
          });
        }
      },
      () => { /* rules deny / offline → keep the seed */ }
    );
  }

  // ---- Date primitives (IST-anchored, tz-safe) ----

  private get timezone(): string {
    return this.calendar().timezone || 'Asia/Kolkata';
  }

  private holidaySet(): Set<string> {
    return new Set(this.calendar().holidays.map(h => h.date));
  }

  /** Today's calendar date in the configured timezone, as 'YYYY-MM-DD'.
   *  en-CA formats exactly as YYYY-MM-DD. */
  today(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.timezone }).format(new Date());
  }

  /** Day-of-week (0=Sun … 6=Sat) for a calendar date, tz-independent. */
  private dayOfWeek(date: string): number {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  /** Add N days to a 'YYYY-MM-DD' string, returning a 'YYYY-MM-DD' string. */
  private addDays(date: string, n: number): string {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }

  // ---- Working-day queries ----

  isWeekend(date: string): boolean {
    return this.calendar().weekends.includes(this.dayOfWeek(date));
  }

  isHoliday(date: string): boolean {
    return this.holidaySet().has(date);
  }

  isWorkingDay(date: string): boolean {
    return !this.isWeekend(date) && !this.isHoliday(date);
  }

  /** Name of the mandatory holiday on this date, if any. */
  holidayName(date: string): string | null {
    return this.calendar().holidays.find(h => h.date === date)?.name ?? null;
  }

  /** Today in IST. (Report always uses the actual calendar date, even if that
   *  day is off — the caller decides whether a report is expected.) */
  currentWorkingDay(): string {
    return this.today();
  }

  /** The next working day strictly after `date` — steps forward past weekends
   *  and mandatory holidays. Friday → Monday automatically. */
  nextWorkingDay(date: string = this.today()): string {
    let d = this.addDays(date, 1);
    // Bounded loop guard: at most a couple of weeks even with holiday runs.
    for (let i = 0; i < 30 && !this.isWorkingDay(d); i++) {
      d = this.addDays(d, 1);
    }
    return d;
  }

  /** The previous working day strictly before `date` (Monday → Friday). */
  previousWorkingDay(date: string = this.today()): string {
    let d = this.addDays(date, -1);
    for (let i = 0; i < 30 && !this.isWorkingDay(d); i++) {
      d = this.addDays(d, -1);
    }
    return d;
  }

  /** IST calendar date ('YYYY-MM-DD') for an absolute instant (e.g. a Firestore
   *  Timestamp's Date) — so "completed today" compares in the team's timezone. */
  toDateStr(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.timezone }).format(d);
  }

  // ---- Formatting ----

  /** '2026-07-13' → '13 July 2026 (Monday)'. */
  formatHeader(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const datePart = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(dt);
    const weekday = new Intl.DateTimeFormat('en-US', {
      weekday: 'long', timeZone: 'UTC'
    }).format(dt);
    return `${datePart} (${weekday})`;
  }

  /** Shorter label for UI chips: '13 Jul'. */
  formatShort(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', timeZone: 'UTC'
    }).format(dt);
  }
}
