import { Directive, ElementRef, HostListener, OnDestroy } from '@angular/core';

@Directive({
  selector: '[data-tooltip]',
  standalone: true
})
export class TooltipDirective implements OnDestroy {
  private tip: HTMLDivElement | null = null;

  constructor(private el: ElementRef<HTMLElement>) {}

  @HostListener('mouseenter')
  show(): void {
    const text = this.el.nativeElement.getAttribute('data-tooltip');
    if (!text) return;

    this.tip = document.createElement('div');
    this.tip.className = 'tp-tooltip';
    this.tip.textContent = text;
    document.body.appendChild(this.tip);

    const rect = this.el.nativeElement.getBoundingClientRect();
    const tip  = this.tip.getBoundingClientRect();

    let top  = rect.top - tip.height - 8;
    let left = rect.left + rect.width / 2 - tip.width / 2;

    // Flip below if off-screen top
    if (top < 8) top = rect.bottom + 8;
    // Clamp horizontal
    left = Math.max(8, Math.min(left, window.innerWidth - tip.width - 8));

    this.tip.style.top  = `${top}px`;
    this.tip.style.left = `${left}px`;
    this.tip.classList.add('tp-tooltip--visible');
  }

  @HostListener('mouseleave')
  @HostListener('click')
  hide(): void {
    this.tip?.remove();
    this.tip = null;
  }

  ngOnDestroy(): void {
    this.tip?.remove();
  }
}
