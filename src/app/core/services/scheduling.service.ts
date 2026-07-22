import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Timestamp } from '@angular/fire/firestore';
import { ScheduledBlock, TimeSlot } from '@shared/models/schedule.model';
import { Task } from '@shared/models/task.model';
import { SupabaseService } from './supabase.service';
import { AiService } from './ai.service';
import { AuthService } from './auth.service';
import { toTs, fromTs } from './supabase-map.util';

// ============================================================
// SchedulingService — smart time-blocking and conflict detection (Supabase).
// ============================================================

@Injectable({ providedIn: 'root' })
export class SchedulingService {
  private readonly supa = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly ai   = inject(AiService);

  readonly schedules  = signal<ScheduledBlock[]>([]);
  readonly isLoading  = signal(false);

  private channel?: RealtimeChannel;

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;

    void this.load(uid);
    this.channel = this.supa.client
      .channel(`schedules:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules', filter: `user_id=eq.${uid}` },
        () => void this.load(uid))
      .subscribe();
  }

  stopListening(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
  }

  private async load(uid: string): Promise<void> {
    const { data } = await this.supa.db('schedules')
      .select('*').eq('user_id', uid).order('start_time', { ascending: true });
    this.schedules.set((data ?? []).map(rowToBlock));
  }

  // ---- Free Slot Detection ----

  getFreeSlots(
    date: Date,
    workStart: string,
    workEnd:   string,
    minDuration = 30
  ): TimeSlot[] {
    const [startH, startM] = workStart.split(':').map(Number);
    const [endH,   endM]   = workEnd.split(':').map(Number);

    const dayStart = new Date(date);
    dayStart.setHours(startH, startM, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(endH, endM, 0, 0);

    // Get blocks for this day
    const dayBlocks = this.schedules()
      .filter(b => {
        const blockDate = b.startTime.toDate();
        return blockDate >= dayStart && blockDate < dayEnd;
      })
      .sort((a, b) => a.startTime.seconds - b.startTime.seconds);

    const slots: TimeSlot[] = [];
    let cursor = dayStart;

    for (const block of dayBlocks) {
      const blockStart = block.startTime.toDate();
      const gapMs      = blockStart.getTime() - cursor.getTime();

      if (gapMs >= minDuration * 60_000) {
        slots.push({
          start:           new Date(cursor),
          end:             new Date(blockStart),
          durationMinutes: Math.floor(gapMs / 60_000)
        });
      }
      cursor = block.endTime.toDate();
    }

    // Final slot to end of day
    const finalGap = dayEnd.getTime() - cursor.getTime();
    if (finalGap >= minDuration * 60_000) {
      slots.push({
        start:           new Date(cursor),
        end:             new Date(dayEnd),
        durationMinutes: Math.floor(finalGap / 60_000)
      });
    }

    return slots;
  }

  // ---- Auto-schedule a task ----

  async autoScheduleTask(
    task:        Task,
    workStart:   string,
    workEnd:     string,
    daysAhead:   number = 7
  ): Promise<ScheduledBlock | null> {
    const uid = this.auth.userId();
    if (!uid || !task.estimatedHours) return null;

    const durationMs = task.estimatedHours * 3_600_000;

    // Try each day starting from today
    for (let i = 0; i <= daysAhead; i++) {
      const day = new Date();
      day.setDate(day.getDate() + i);

      // Skip if past due date
      if (task.dueDate && day > task.dueDate.toDate()) break;

      const slots = this.getFreeSlots(day, workStart, workEnd);
      const fit   = slots.find(s => s.durationMinutes * 60_000 >= durationMs);

      if (fit) {
        const startTime = fit.start;
        const endTime   = new Date(startTime.getTime() + durationMs);

        return this.createScheduleBlock({
          taskId:        task.id,
          startTime:     Timestamp.fromDate(startTime),
          endTime:       Timestamp.fromDate(endTime),
          autoScheduled: true,
          hasConflict:   false
        });
      }
    }

    return null;
  }

  // ---- CRUD ----

  async createScheduleBlock(
    data: Omit<ScheduledBlock, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<ScheduledBlock> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const { data: row, error } = await this.supa.db('schedules').insert({
      user_id:           uid,
      task_id:           data.taskId ?? null,
      start_time:        fromTs(data.startTime),
      end_time:          fromTs(data.endTime),
      auto_scheduled:    data.autoScheduled ?? false,
      calendar_event_id: data.calendarEventId ?? null,
      provider:          data.provider ?? null,
      has_conflict:      data.hasConflict ?? false,
      conflict_with:     data.conflictWith ?? [],
    }).select('id').single();
    if (error) throw error;

    return { ...data, id: row.id, userId: uid } as ScheduledBlock;
  }

  async updateBlock(id: string, changes: Partial<ScheduledBlock>): Promise<void> {
    await this.supa.db('schedules').update(blockPatch(changes)).eq('id', id);
  }

  async deleteBlock(id: string): Promise<void> {
    await this.supa.db('schedules').delete().eq('id', id);
  }

  // ---- Conflict Detection ----

  detectConflicts(): Map<string, string[]> {
    const blocks    = [...this.schedules()].sort((a, b) => a.startTime.seconds - b.startTime.seconds);
    const conflicts = new Map<string, string[]>();

    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        if (a.endTime.seconds > b.startTime.seconds) {
          if (!conflicts.has(a.id)) conflicts.set(a.id, []);
          if (!conflicts.has(b.id)) conflicts.set(b.id, []);
          conflicts.get(a.id)!.push(b.id);
          conflicts.get(b.id)!.push(a.id);
        } else {
          break; // sorted, no more overlaps for a
        }
      }
    }

    return conflicts;
  }

  // ---- Reschedule overdue ----

  async rescheduleOverdueTasks(
    overdueTasks: Task[],
    workStart:    string,
    workEnd:      string
  ): Promise<void> {
    for (const task of overdueTasks) {
      if (task.estimatedHours) {
        await this.autoScheduleTask(task, workStart, workEnd);
      }
    }
  }
}

// ---- Mapping ----

function rowToBlock(r: any): ScheduledBlock {
  return {
    id:              r.id,
    userId:          r.user_id,
    taskId:          r.task_id,
    startTime:       toTs(r.start_time) as any,
    endTime:         toTs(r.end_time) as any,
    autoScheduled:   r.auto_scheduled,
    calendarEventId: r.calendar_event_id ?? undefined,
    provider:        r.provider ?? undefined,
    hasConflict:     r.has_conflict,
    conflictWith:    r.conflict_with ?? [],
    createdAt:       toTs(r.created_at) as any,
    updatedAt:       toTs(r.updated_at) as any,
  };
}

function blockPatch(c: Partial<ScheduledBlock>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (c.taskId          !== undefined) p['task_id']           = c.taskId;
  if (c.startTime       !== undefined) p['start_time']        = fromTs(c.startTime);
  if (c.endTime         !== undefined) p['end_time']          = fromTs(c.endTime);
  if (c.autoScheduled   !== undefined) p['auto_scheduled']    = c.autoScheduled;
  if (c.calendarEventId !== undefined) p['calendar_event_id'] = c.calendarEventId;
  if (c.provider        !== undefined) p['provider']          = c.provider;
  if (c.hasConflict     !== undefined) p['has_conflict']      = c.hasConflict;
  if (c.conflictWith    !== undefined) p['conflict_with']     = c.conflictWith;
  return p;
}
