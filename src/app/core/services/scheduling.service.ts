import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import {
  Firestore, collection, query, where, orderBy,
  onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, Timestamp, writeBatch
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';
import { ScheduledBlock, TimeSlot } from '@shared/models/schedule.model';
import { Task } from '@shared/models/task.model';
import { AiService } from './ai.service';
import { AuthService } from './auth.service';

// ============================================================
// SchedulingService — Smart time-blocking and conflict detection
// ============================================================

@Injectable({ providedIn: 'root' })
export class SchedulingService {
  private readonly firestore = inject(Firestore);
  private readonly auth      = inject(AuthService);
  private readonly ai        = inject(AiService);

  readonly schedules  = signal<ScheduledBlock[]>([]);
  readonly isLoading  = signal(false);

  private unsubscribe?: () => void;

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;

    const q = query(
      collection(this.firestore, 'schedules'),
      where('userId', '==', uid),
      orderBy('startTime', 'asc')
    );

    this.unsubscribe = onSnapshot(q, snap => {
      this.schedules.set(snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduledBlock)));
    });
  }

  stopListening(): void {
    this.unsubscribe?.();
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

    const ref = await addDoc(collection(this.firestore, 'schedules'), {
      ...data,
      userId:    uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return { ...data, id: ref.id, userId: uid } as ScheduledBlock;
  }

  async updateBlock(id: string, changes: Partial<ScheduledBlock>): Promise<void> {
    await updateDoc(doc(this.firestore, 'schedules', id), {
      ...changes,
      updatedAt: serverTimestamp()
    });
  }

  async deleteBlock(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, 'schedules', id));
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
