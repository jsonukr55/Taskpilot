import { Directive, ElementRef, EventEmitter, Input, Output, HostListener, inject, OnChanges } from '@angular/core';

// ============================================================
// EditableBlockDirective — bridges a contentEditable element and
// the block model without clobbering the caret while typing.
//   - Writes model → DOM only when the element is NOT focused
//     (so remote/live updates apply without moving the local caret).
//   - Emits DOM → model on input.
// ============================================================
@Directive({
  selector: '[tpEditable]',
  standalone: true
})
export class EditableBlockDirective implements OnChanges {
  @Input('tpEditable') html = '';
  @Output() htmlChange = new EventEmitter<string>();

  private readonly el = inject(ElementRef<HTMLElement>);

  ngOnChanges(): void {
    const node = this.el.nativeElement;
    if (document.activeElement !== node && node.innerHTML !== (this.html ?? '')) {
      node.innerHTML = this.html ?? '';
    }
  }

  @HostListener('input')
  onInput(): void {
    this.htmlChange.emit(this.el.nativeElement.innerHTML);
  }

  /** Current plain text (used for markdown-shortcut / empty detection). */
  get text(): string {
    return this.el.nativeElement.textContent ?? '';
  }
}
