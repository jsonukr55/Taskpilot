import { Directive, ElementRef, inject, input, output, AfterViewInit, OnDestroy } from '@angular/core';

// ============================================================
// [tpAnchor] — pin a popover to a trigger, escaping every overflow/clip/
// transform ancestor. The element is teleported to <body> (so its containing
// block is the viewport) and positioned fixed under the trigger; it flips above
// when there's no room below and clamps to the viewport.
//
// Closing is handled here so callers don't need a backdrop: (dismiss) fires on
// any scroll/resize (a detached fixed panel would drift) and on a pointerdown
// outside both the popover and its trigger. Angular still owns the element
// (bindings + emulated-encapsulation styles work wherever it lives); on destroy
// we remove the teleported node ourselves, so Angular's own teardown just no-ops
// on the detached node — no orphaned popovers, no renderer removeChild errors.
//
//   <button #t ...></button>
//   <div class="popover" [tpAnchor]="t" (dismiss)="close()"> … </div>
// ============================================================
@Directive({ selector: '[tpAnchor]', standalone: true })
export class AnchorDirective implements AfterViewInit, OnDestroy {
  readonly anchor  = input.required<HTMLElement>({ alias: 'tpAnchor' });
  readonly dismiss = output<void>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private destroyed = false;
  private readonly onScroll = () => this.dismiss.emit();
  private readonly onDocDown = (e: Event) => {
    const t = e.target as Node;
    const trigger = this.anchor();
    if (!this.el.nativeElement.contains(t) && !(trigger && trigger.contains(t))) this.dismiss.emit();
  };
  // Capture + stopPropagation so this popover swallows Escape before any outer
  // overlay (e.g. a modal it's opened inside of) also closes on the same key.
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); this.dismiss.emit(); }
  };

  ngAfterViewInit(): void {
    document.body.appendChild(this.el.nativeElement);   // escape any clip/transform ancestor
    this.place();
    document.addEventListener('scroll', this.onScroll, true);   // capture: any scroll container
    window.addEventListener('resize', this.onScroll);
    document.addEventListener('keydown', this.onKey, true);      // Escape closes
    // Close on outside click. Deferred so the opening click doesn't dismiss it.
    setTimeout(() => { if (!this.destroyed) document.addEventListener('pointerdown', this.onDocDown, true); }, 0);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    document.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onScroll);
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('pointerdown', this.onDocDown, true);
    // We moved the node to <body>, so remove it ourselves; Angular's own
    // teardown then sees a detached node and no-ops (no orphaned popovers).
    this.el.nativeElement.remove();
  }

  private place(): void {
    const trigger = this.anchor();
    if (!trigger) return;
    const pop = this.el.nativeElement;
    const r = trigger.getBoundingClientRect();
    const w = pop.offsetWidth  || 260;
    const h = pop.offsetHeight || 260;

    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < h && r.top > spaceBelow;
    const overflowsRight = r.left + w > window.innerWidth - 8;

    const left = overflowsRight ? Math.max(8, r.right - w) : r.left;
    const top  = openUp ? Math.max(8, r.top - h - 6) : r.bottom + 6;

    Object.assign(pop.style, {
      position: 'fixed',
      left:  `${left}px`,
      top:   `${top}px`,
      right: 'auto',
      bottom: 'auto',
      zIndex: '1000',
    });
  }
}
