import { Directive, ElementRef, inject, input, output, AfterViewInit, OnDestroy } from '@angular/core';

// ============================================================
// [tpAnchor] — pin a popover to a trigger with position: fixed, so it escapes
// any overflow/clip ancestor (e.g. the board's horizontally-scrolling table).
// Same technique tp-select uses for its chip panel. Flips above the trigger
// when there isn't room below, clamps to the viewport, and emits (dismiss) on
// scroll/resize so the host can close it (a fixed panel must not detach).
//
//   <button #t ...></button>
//   <div class="popover" [tpAnchor]="t" (dismiss)="close()"> … </div>
// ============================================================
@Directive({ selector: '[tpAnchor]', standalone: true })
export class AnchorDirective implements AfterViewInit, OnDestroy {
  readonly anchor  = input.required<HTMLElement>({ alias: 'tpAnchor' });
  readonly dismiss = output<void>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly onScroll = () => this.dismiss.emit();

  ngAfterViewInit(): void {
    this.place();
    document.addEventListener('scroll', this.onScroll, true);   // capture: any scroll container
    window.addEventListener('resize', this.onScroll);
  }

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onScroll);
  }

  private place(): void {
    const trigger = this.anchor();
    if (!trigger) return;
    const pop = this.el.nativeElement;
    const r = trigger.getBoundingClientRect();
    const origin = this.fixedOrigin();
    const w = pop.offsetWidth  || 220;
    const h = pop.offsetHeight || 240;

    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < h && r.top > spaceBelow;
    const overflowsRight = r.left + w > window.innerWidth - 8;

    const left = (overflowsRight ? Math.max(8, r.right - w) : r.left) - origin.x;
    const top  = (openUp ? r.top - h - 6 : r.bottom + 6) - origin.y;

    Object.assign(pop.style, {
      position: 'fixed',
      left:  `${left}px`,
      top:   `${top}px`,
      right: 'auto',
      bottom: 'auto',
      zIndex: '1000',
    });
  }

  /** position: fixed resolves against the nearest transformed/filtered/contained
   *  ancestor, not the viewport. Pages here carry entrance transforms, so return
   *  that ancestor's origin to subtract (mirrors SelectComponent.fixedOrigin). */
  private fixedOrigin(): { x: number; y: number } {
    let el: HTMLElement | null = this.el.nativeElement.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const s = getComputedStyle(el);
      if (s.transform !== 'none' || s.perspective !== 'none' || s.filter !== 'none' ||
          s.willChange.includes('transform') || s.willChange.includes('filter') ||
          s.contain.includes('paint') || s.contain.includes('layout') ||
          s.backdropFilter !== 'none') {
        const rr = el.getBoundingClientRect();
        return { x: rr.left, y: rr.top };
      }
      el = el.parentElement;
    }
    return { x: 0, y: 0 };
  }
}
