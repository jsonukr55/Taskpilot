import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { CategoryService } from '@core/services/category.service';
import { TaskService } from '@core/services/task.service';
import { IconComponent } from '@shared/components/icon/icon.component';
import { TooltipDirective } from '@shared/directives/tooltip.directive';
import { Category } from '@shared/models/category.model';

const CATEGORY_ICONS = ['💼', '🏠', '🏃', '📚', '💰', '🎯', '🎨', '🔧', '🌱', '✈️', '💊', '🎵', '🍳', '📱', '🏋️'];
const CATEGORY_COLORS = ['#6366f1','#10b981','#f59e0b','#f43f5e','#8b5cf6','#0ea5e9','#ec4899','#14b8a6','#f97316','#84cc16'];

@Component({
  selector:   'tp-categories',
  standalone: true,
  imports:    [FormsModule, ReactiveFormsModule, IconComponent, DecimalPipe, TooltipDirective],
  templateUrl: './categories.component.html',
  styleUrl:    './categories.component.scss'
})
export class CategoriesComponent {
  readonly categories  = inject(CategoryService);
  readonly taskService = inject(TaskService);
  private readonly fb  = inject(FormBuilder);

  readonly showForm    = signal(false);
  readonly editingId   = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  readonly ICONS  = CATEGORY_ICONS;
  readonly COLORS = CATEGORY_COLORS;

  readonly form = this.fb.group({
    name:        ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    icon:        ['📁'],
    color:       ['#6366f1'],
    parentId:    [null as string | null],
    keywords:    [''],
    preferredStart: ['09:00'],
    preferredEnd:   ['18:00'],
    priorityBias:   ['medium'],
    reminderMinutes: [30]
  });

  readonly categoryWithStats = computed(() =>
    this.categories.rootCategories().map(cat => ({
      cat,
      taskCount: this.taskService.getTasksByCategory(cat.id).length,
      doneCount: this.taskService.getTasksByCategory(cat.id).filter(t => t.status === 'completed').length,
      children:  this.categories.categories().filter(c => c.parentId === cat.id)
    }))
  );

  startCreate(): void {
    this.editingId.set(null);
    this.form.reset({ icon: '📁', color: '#6366f1', priorityBias: 'medium', preferredStart: '09:00', preferredEnd: '18:00', reminderMinutes: 30 });
    this.showForm.set(true);
  }

  startEdit(cat: Category): void {
    this.editingId.set(cat.id);
    this.form.patchValue({
      name:        cat.name,
      description: cat.description ?? '',
      icon:        cat.icon,
      color:       cat.color,
      parentId:    cat.parentId ?? null,
      keywords:    (cat.keywords ?? []).join(', '),
      preferredStart: cat.rules.preferredHours?.start ?? '09:00',
      preferredEnd:   cat.rules.preferredHours?.end   ?? '18:00',
      priorityBias:   cat.rules.priorityBias ?? 'medium',
      reminderMinutes: cat.rules.reminderMinutes?.[0] ?? 30
    });
    this.showForm.set(true);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.isSubmitting.set(true);
    const v = this.form.value;

    const data: Omit<Category, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
      name:        v.name!,
      description: v.description ?? '',
      icon:        v.icon!,
      color:       v.color!,
      parentId:    v.parentId ?? null,
      keywords:    v.keywords ? v.keywords.split(',').map((k: string) => k.trim()).filter(Boolean) : [],
      order:       this.categories.categories().length,
      rules: {
        preferredHours:  { start: v.preferredStart!, end: v.preferredEnd! },
        priorityBias:    v.priorityBias as 'low' | 'medium' | 'high',
        reminderMinutes: [v.reminderMinutes ?? 30]
      }
    };

    try {
      if (this.editingId()) {
        await this.categories.update(this.editingId()!, data);
      } else {
        await this.categories.create(data);
      }
      this.showForm.set(false);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async deleteCategory(id: string, name: string): Promise<void> {
    if (!confirm(`Delete "${name}"? Tasks in this category will be uncategorized.`)) return;
    await this.categories.delete(id);
  }
}
