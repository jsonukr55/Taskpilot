import { Directive, ElementRef, inject, input, output, AfterViewInit, OnDestroy } from '@angular/core';

// ============================================================
// [tpAnchor] — pin a popover to a trigger, escaping every overflow/clip/
// transform ancestor. The element is teleported to <body> (so its containing
// block is the viewport) and positioned fixed under the trigger; it flips above
// when there's no room below and clamps to the viewport. Emits (dismiss) on any
// scroll/resize so the host can close it (a detached fixed panel would drift).
//
// Angular still owns the element (bindings + emulated-encapsulation styles work
// wherever it lives); a comment placeholder marks its original slot so it's
// restored before the view is destroyed — no renderer removeChild errors.
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
  private placeholder?: Comment;

  ngAfterViewInit(): void {
    const el = this.el.nativeElement;
    this.placeholder = document.createComment('tpAnchor');
    el.parentNode?.insertBefore(this.placeholder, el);
    document.body.appendChild(el);
    this.place();
    document.addEventListener('scroll', this.onScroll, true);   // capture: any scroll container
    window.addEventListener('resize', this.onScroll);
  }

  ngOnDestroy(): void {
    document.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onScroll);
    // Restore to the original slot so Angular's view teardown removes it cleanly.
    const el = this.el.nativeElement;
    const ph = this.placeholder;
    if (ph?.parentNode) { ph.parentNode.insertBefore(el, ph); ph.remove(); }
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
