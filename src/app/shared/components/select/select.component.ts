import {
  Component, input, output, signal, computed, forwardRef, effect, ElementRef, inject, HostListener, booleanAttribute,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

// ============================================================
// tp-select — fully custom dropdown (replaces native <select>)
// Works with reactive forms (formControlName / ngModel) via
// ControlValueAccessor, and with plain [value] + (changed) too.
// ============================================================

export interface SelectOption {
  value: any;
  label: string;
  icon?:  string;   // emoji or short glyph, rendered as-is
  color?: string;   // optional swatch color (e.g. category color)
}

@Component({
  selector: 'tp-select',
  standalone: true,
  imports: [],
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectComponent), multi: true },
  ],
  host: {
    class: 'tp-select-host',
    '[class.tp-select-host--pill]': 'pill()',
  },
})
export class SelectComponent implements ControlValueAccessor {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly options     = input<SelectOption[]>([]);
  readonly placeholder = input('Select…');
  readonly value       = input<any>(undefined);       // for non-form usage
  readonly pill        = input(false, { transform: booleanAttribute });   // compact filter-pill style

  readonly changed = output<any>();

  readonly open        = signal(false);
  readonly disabled    = signal(false);
  readonly activeIndex = signal(-1);
  private readonly _value = signal<any>(null);

  readonly selected = computed(() =>
    this.options().find(o => o.value === this._value()) ?? null
  );

  constructor() {
    // Sync the [value] input into internal state for non-form usage.
    effect(() => {
      const v = this.value();
      if (v !== undefined) this._value.set(v);
    }, { allowSignalWrites: true });
  }

  // ---- ControlValueAccessor ----
  private onChange: (v: any) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: any): void { this._value.set(v); }
  registerOnChange(fn: (v: any) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.disabled.set(d); }

  // ---- Interaction ----
  toggle(): void {
    if (this.disabled()) return;
    this.open.update(o => !o);
    if (this.open()) {
      const idx = this.options().findIndex(o => o.value === this._value());
      this.activeIndex.set(idx);
    } else {
      this.onTouched();
    }
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.onTouched();
  }

  pick(o: SelectOption): void {
    this._value.set(o.value);
    this.onChange(o.value);
    this.changed.emit(o.value);
    this.close();
  }

  isSelected(o: SelectOption): boolean {
    return o.value === this._value();
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target)) this.close();
  }

  @HostListener('keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (this.disabled()) return;
    const opts = this.options();

    if (!this.open()) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.toggle();
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.activeIndex.set(Math.min(this.activeIndex() + 1, opts.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.activeIndex.set(Math.max(this.activeIndex() - 1, 0));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        { const o = opts[this.activeIndex()]; if (o) this.pick(o); }
        break;
    }
  }
}
