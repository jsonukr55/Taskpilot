import { Component, OnInit, inject, signal, computed, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AiService, ChatMessage, ChatIntent } from '@core/services/ai.service';
import { TaskService } from '@core/services/task.service';
import { CategoryService } from '@core/services/category.service';
import { AuthService } from '@core/services/auth.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { Timestamp } from '@angular/fire/firestore';

interface DisplayMessage extends ChatMessage {
  id:      string;
  time:    Date;
  pending?: boolean;
}

@Component({
  selector:   'tp-ai-chat',
  standalone: true,
  imports:    [FormsModule, RouterLink, IconComponent, DatePipe],
  templateUrl: './ai-chat.component.html',
  styleUrl:    './ai-chat.component.scss'
})
export class AiChatComponent implements AfterViewChecked {
  @ViewChild('messagesEnd') messagesEnd!: ElementRef;

  private readonly ai          = inject(AiService);
  readonly taskService          = inject(TaskService);
  private readonly categories   = inject(CategoryService);
  private readonly auth         = inject(AuthService);

  readonly messages   = signal<DisplayMessage[]>([]);
  readonly inputText  = signal('');
  readonly isTyping   = signal(false);
  readonly error      = signal<string | null>(null);

  readonly suggestions = [
    'What tasks are overdue?',
    'Move all work tasks to tomorrow',
    'Schedule gym for evening',
    'Delay everything by 2 days',
    'What should I focus on today?',
    'Create a task: call the bank by Friday',
  ];

  private readonly HISTORY_KEY     = 'tp_chat_history';
  private readonly HISTORY_VERSION = 2; // bump to invalidate old cached data

  constructor() {
    this.loadHistory();
  }

  private loadHistory(): void {
    try {
      const saved = localStorage.getItem(this.HISTORY_KEY);
      if (saved) {
        const data = JSON.parse(saved) as { v?: number; msgs: Array<DisplayMessage & { time: string }> };
        // Only restore if version matches
        if (data.v === this.HISTORY_VERSION && Array.isArray(data.msgs)) {
          this.messages.set(data.msgs.map(m => ({ ...m, time: new Date(m.time) })));
          return;
        }
        // Old format — clear it
        localStorage.removeItem(this.HISTORY_KEY);
      }
    } catch {}

    // No history — show welcome message
    this.messages.set([{
      id:      'welcome',
      role:    'assistant',
      content: `Hi there! I'm your TaskPilot AI assistant. I can help you:

• **Create tasks** from natural language
• **Create categories**
• **Move or reschedule** tasks
• **Delay** all or specific tasks
• **Answer questions** about your workload

What would you like to do?`,
      time: new Date()
    }]);
  }

  private saveHistory(): void {
    try {
      const payload = { v: this.HISTORY_VERSION, msgs: this.messages().slice(-50) };
      localStorage.setItem(this.HISTORY_KEY, JSON.stringify(payload));
    } catch {}
  }

  clearHistory(): void {
    localStorage.removeItem(this.HISTORY_KEY);
    this.messages.set([{
      id:      'welcome',
      role:    'assistant',
      content: 'Chat history cleared. How can I help you?',
      time:    new Date()
    }]);
  }

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    try {
      this.messagesEnd?.nativeElement?.scrollIntoView({ behavior: 'smooth' });
    } catch {}
  }

  async sendMessage(): Promise<void> {
    const text = this.inputText().trim();
    if (!text || this.isTyping()) return;

    const userMsg: DisplayMessage = {
      id:      crypto.randomUUID(),
      role:    'user',
      content: text,
      time:    new Date()
    };

    this.messages.update(msgs => [...msgs, userMsg]);
    this.inputText.set('');
    this.isTyping.set(true);
    this.error.set(null);

    try {
      const history: ChatMessage[] = this.messages()
        .filter(m => !m.pending && m.id !== 'welcome')
        .map(m => ({ role: m.role, content: m.content }));

      const userContext = {
        totalTasks:   this.taskService.tasks().length,
        overdueTasks: this.taskService.overdueTasks().length,
        todayTasks:   this.taskService.todayTasks().length,
        categories:   this.categories.categories().map(c => ({ id: c.id, name: c.name })),
        timezone:     this.auth.userProfile()?.preferences.timezone ?? 'UTC'
      };

      const response = await this.ai.chat(history, userContext);

      // Execute all intents sequentially
      if (response.intents?.length) {
        await this.executeIntents(response.intents);
      }

      const assistantMsg: DisplayMessage = {
        id:      crypto.randomUUID(),
        role:    'assistant',
        content: response.message,
        time:    new Date()
      };

      this.messages.update(msgs => [...msgs, assistantMsg]);
      this.saveHistory();
    } catch (e) {
      this.error.set('Failed to send message. Please try again.');
    } finally {
      this.isTyping.set(false);
    }
  }

  private async executeIntents(intents: ChatIntent[]): Promise<void> {
    // Track newly created category id so tasks in the same batch can reference it
    let newCategoryId: string | null = null;

    for (const intent of intents) {
      const e = intent.entities;

      switch (intent.action) {
        case 'move_tasks':
        case 'delay_tasks': {
          const days = (e['daysOffset'] as number) ?? 1;
          const filterIds = e['categoryIds'] as string[] | undefined;
          let tasks = this.taskService.tasks().filter(t => t.status !== 'completed');
          if (filterIds?.length) tasks = tasks.filter(t => t.categoryIds.some(id => filterIds.includes(id)));
          for (const task of tasks) {
            if (!task.dueDate) continue;
            const d = new Date(task.dueDate.toDate());
            d.setDate(d.getDate() + days);
            await this.taskService.updateTask(task.id, { dueDate: Timestamp.fromDate(d) });
          }
          break;
        }

        case 'complete_tasks': {
          const filterIds = e['categoryIds'] as string[] | undefined;
          let tasks = this.taskService.tasks().filter(t => t.status !== 'completed');
          if (filterIds?.length) tasks = tasks.filter(t => t.categoryIds.some(id => filterIds.includes(id)));
          await this.taskService.bulkUpdateStatus(tasks.map(t => t.id), 'completed');
          break;
        }

        case 'create_category': {
          const name  = e['name'] as string;
          const icon  = (e['icon'] as string) ?? '📁';
          const color = (e['color'] as string) ?? '#6366f1';
          if (name) {
            newCategoryId = await this.categories.create({
              name, icon, color,
              rules: {}, order: this.categories.categories().length,
              parentId: null, keywords: []
            });
          }
          break;
        }

        case 'create_task': {
          const title    = (e['title'] ?? e['taskTitle']) as string;
          const priority = (e['priority'] as string) ?? 'medium';
          const dueDate  = e['dueDate'] as string | null;
          // "__new__" means "use the category just created above"
          const rawCatId = e['categoryId'] as string | null;
          let catId: string | null = null;
          if (rawCatId === '__new__') {
            catId = newCategoryId;
          } else if (rawCatId && this.categories.getCategoryById(rawCatId)) {
            catId = rawCatId;
          }
          if (title) {
            await this.taskService.createTask({
              title, description: '', status: 'todo',
              priority:    priority as 'low' | 'medium' | 'high' | 'urgent',
              startDate:   null,
              dueDate:     dueDate ? Timestamp.fromDate(new Date(dueDate)) : null,
              dueTime:     null, estimatedHours: null, actualHours: null,
              categoryIds: catId ? [catId] : [],
              tags: [], checklist: [], timeBlocks: [], recurrence: null,
              isScheduled: false, completedAt: null, imageUrl: null, reminders: [],
              aiMetadata:  { confidence: 0.9, extractionMethod: 'chat' }
            });
          }
          break;
        }
      }
    }
  }

  useSuggestion(s: string): void {
    this.inputText.set(s);
    this.sendMessage();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  formatMessage(text: string): string {
    // Convert **bold** and bullet points
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^• /gm, '• ')
      .split('\n').join('<br>');
  }
}
