import { Directive, ElementRef, HostListener, inject } from '@angular/core';

// Open the native date/time picker when the input itself is clicked
// (browsers only open it on the small calendar/clock icon by default).
@Directive({
  selector: 'input[type=date], input[type=time], input[type=datetime-local], input[type=month], input[type=week]',
  standalone: true
})
export class ShowPickerDirective {
  private readonly el = inject(ElementRef<HTMLInputElement & { showPicker?: () => void }>);

  @HostListener('click')
  onClick(): void {
    try { this.el.nativeElement.showPicker?.(); } catch { /* already open / unsupported */ }
  }
}
