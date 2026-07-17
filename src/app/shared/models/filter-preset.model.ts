import { TaskFilter, TaskSortOption } from '@core/services/task.service';

// ============================================================
// Filter Preset Models — reusable saved/quick/recent filter shapes.
// A preset is a complete, replayable snapshot of the task view's
// filter + sort + search. Built-in "quick" presets ship with the app;
// "saved" and "recent" presets are user-scoped and persisted locally
// (localStorage — no Firestore schema change).
// ============================================================

export type PresetKind = 'quick' | 'saved' | 'recent';

export interface FilterPreset {
  id:      string;
  label:   string;
  /** tp-icon name or emoji glyph for the chip. */
  icon?:   string;
  kind:    PresetKind;
  filter:  TaskFilter;
  sort?:   TaskSortOption;
  search?: string;
}
