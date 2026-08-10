import {
  Component, input, output, signal, computed, forwardRef, effect, ElementRef, inject, HostListener,
  booleanAttribute, OnDestroy,
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
    '[class.tp-select-host--chip]': 'chip()',
  },
})
export class SelectComponent implements ControlValueAccessor, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly options     = input<SelectOption[]>([]);
  readonly placeholder = input('Select…');
  readonly value       = input<any>(undefined);       // for non-form usage
  readonly pill        = input(false, { transform: booleanAttribute });   // compact filter-pill style
  readonly chip        = input(false, { transform: booleanAttribute });   // dense in-table chip (board cells)

  readonly changed = output<any>();

  readonly open        = signal(false);
  readonly disabled    = signal(false);
  readonly activeIndex = signal(-1);
  private readonly _value = signal<any>(null);

  /** Chip variant only: viewport-fixed panel coords (see positionPanel). */
  readonly panelStyle = signal<Record<string, string> | null>(null);
  private scrollHandler?: () => void;

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
    if (this.open()) { this.close(); return; }   // close() must see open === true
    this.open.set(true);
    this.activeIndex.set(this.options().findIndex(o => o.value === this._value()));
    this.positionPanel();
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.releasePanel();
    this.onTouched();
  }

  /**
   * Chip selects live inside the board table, whose wrapper needs
   * `overflow-x: auto` for wide column sets — and that clips an absolutely
   * positioned panel. So the chip panel is positioned against the viewport
   * instead, which no ancestor can clip. It flips above the control when
   * there isn't room below, and closes on any scroll so it can't detach.
   */
  private positionPanel(): void {
    // Fixed-position the panel for every variant so it escapes any overflow /
    // scroll ancestor (board table, scrollable modal bodies, etc.) rather than
    // being clipped by it.
    const el = this.host.nativeElement.querySelector('.tp-select__control') as HTMLElement | null;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const origin = this.fixedOrigin();          // see below — not always the viewport
    const width = Math.max(180, r.width);
    const height = Math.min(280, this.options().length * 36 + 16);

    // Flip above the control when there isn't room below it.
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < height && r.top > spaceBelow;

    // Anchor to the control's left edge; if that would run off the right of
    // the viewport, align the panel's right edge to the control's instead.
    const overflowsRight = r.left + width > window.innerWidth - 8;
    const left = overflowsRight
      ? Math.max(8, r.right - width)
      : r.left;
    const top  = openUp ? r.top - height - 6 : r.bottom + 6;

    this.panelStyle.set({
      position: 'fixed',
      left:  `${left - origin.x}px`,
      top:   `${top - origin.y}px`,
      width: `${width}px`,
      right: 'auto',
      bottom: 'auto',
    });

    // Capture phase so scrolling of any ancestor container is caught too.
    this.scrollHandler = () => this.close();
    document.addEventListener('scroll', this.scrollHandler, true);
    window.addEventListener('resize', this.scrollHandler);
  }

  /**
   * `position: fixed` resolves against the viewport ONLY if no ancestor
   * establishes a containing block. A transform / filter / perspective does,
   * and the pages here carry entrance animations (`.fade-in` ends on
   * `transform: translateY(0)`, which still counts) — so a fixed panel was
   * being offset by the whole content area. Returns the origin to subtract.
   */
  private fixedOrigin(): { x: number; y: number } {
    let el: HTMLElement | null = this.host.nativeElement.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const s = getComputedStyle(el);
      if (s.transform !== 'none' || s.perspective !== 'none' || s.filter !== 'none' ||
          s.willChange.includes('transform') || s.willChange.includes('filter') ||
          s.contain.includes('paint') || s.contain.includes('layout') ||
          s.backdropFilter !== 'none') {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top };
      }
      el = el.parentElement;
    }
    return { x: 0, y: 0 };
  }

  private releasePanel(): void {
    if (this.scrollHandler) {
      document.removeEventListener('scroll', this.scrollHandler, true);
      window.removeEventListener('resize', this.scrollHandler);
      this.scrollHandler = undefined;
    }
    this.panelStyle.set(null);
  }

  ngOnDestroy(): void {
    this.releasePanel();
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
        e.stopPropagation();   // don't also close an outer overlay
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
