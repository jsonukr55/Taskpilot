import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@env/environment';
import { AiExtractedTask } from '@shared/models/task.model';
import { Category } from '@shared/models/category.model';
import { AuthService } from './auth.service';

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }
export interface ChatIntent  { action: string; entities: Record<string, unknown>; }
export interface AiChatResponse { message: string; intents?: ChatIntent[]; }

// ============================================================
// AiService — thin client for the Cloud Functions AI proxy.
// The Groq API key lives server-side (functions/.env); the browser
// only ever sends the user's Firebase ID token.
// ============================================================
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = environment.functionsBaseUrl;

  /** Master switch. While false, every AI call short-circuits (no network) so
   *  the whole feature reads as "coming soon" and nothing hits a dead endpoint. */
  readonly enabled = environment.features.ai;

  private async post<T>(fn: string, body: unknown): Promise<T> {
    const token = await this.auth.getAccessToken();
    return firstValueFrom(this.http.post<T>(`${this.base}/${fn}`, body, {
      headers: { Authorization: `Bearer ${token ?? ''}` }
    }));
  }

  async extractTasksFromText(text: string, categories: Category[], userTimezone = 'UTC'): Promise<AiExtractedTask[]> {
    if (!this.enabled) return [];
    const res = await this.post<{ tasks: AiExtractedTask[] }>('extractTasks', {
      text,
      categories: categories.map(c => ({ id: c.id, name: c.name, keywords: c.keywords ?? [] })),
      userTimezone
    });
    return (res.tasks ?? []).filter(t => t?.title);
  }

  async extractTasksFromImage(base64Image: string, mimeType: string, categories: Category[]): Promise<AiExtractedTask[]> {
    if (!this.enabled) return [];
    const res = await this.post<{ tasks: AiExtractedTask[] }>('extractTasksFromImage', {
      base64Image,
      mimeType,
      categories: categories.map(c => ({ id: c.id, name: c.name }))
    });
    return (res.tasks ?? []).filter(t => t?.title);
  }

  async chat(
    messages: ChatMessage[],
    userContext: { totalTasks: number; overdueTasks: number; todayTasks: number; categories: Array<{ id: string; name: string }>; timezone: string }
  ): Promise<AiChatResponse> {
    if (!this.enabled) return { message: 'AI features are coming soon.', intents: [] };
    return this.post<AiChatResponse>('chat', { messages, userContext });
  }

  async generateInsights(stats: {
    tasksByCategory: Record<string, number>; completionRates: Record<string, number>;
    delayPatterns: Record<string, number>; overdueCount: number; tomorrowTaskCount: number; streak: number;
  }): Promise<Array<{ type: string; title: string; body: string; severity: string }>> {
    if (!this.enabled) return [];
    const res = await this.post<{ insights: Array<{ type: string; title: string; body: string; severity: string }> }>(
      'generateInsights', { stats }
    );
    return res.insights ?? [];
  }

  async suggestSchedule(params: {
    tasks: Array<{ id: string; title: string; estimatedHours: number; priority: string; dueDate?: string }>;
    availableSlots: Array<{ start: string; end: string }>;
    preferences: { workingHours: { start: string; end: string }; timezone: string };
  }): Promise<Array<{ taskId: string; suggestedStart: string; suggestedEnd: string; reason: string }>> {
    if (!this.enabled) return [];
    const res = await this.post<{ schedule: Array<{ taskId: string; suggestedStart: string; suggestedEnd: string; reason: string }> }>(
      'suggestSchedule', params
    );
    return res.schedule ?? [];
  }

  /** Writing assistant used by the notes editor's selection menu. */
  async transformText(instruction: string, text: string): Promise<string> {
    if (!this.enabled) return text;   // no-op: return the text unchanged
    const res = await this.post<{ text: string }>('transformText', { instruction, text });
    return res.text ?? '';
  }
}
