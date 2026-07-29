import { Component, input } from '@angular/core';

// ============================================================
// tp-brand-mark — the TaskPilot logo. The single source for the mark;
// every surface that shows the logo (sidebar, login) renders this rather
// than pasting the SVG again. src/favicon.svg is a manual copy of the
// same geometry — keep the two in sync.
//
// Geometry: a 100x100 grid, centre (50,50). One arm — three bars in a
// descending stagger plus a square — is defined once, then repeated at
// 90/180/270 degrees. Every rect below is that rotation applied by hand:
//     rect(x, y, w, h)  ->  rect(100 - y - h, x, h, w)
// Four rotations return exactly to the start, so the arms are identical
// shapes and the mark is balanced by construction rather than by eye.
// Nothing overlaps: the gap between every pair of neighbours is 3 units,
// and the ink sits inside 6..94 on both axes.
//
// Colour runs by arm — north blue, east orange, south green, west purple.
// The south arm's long bar is blue rather than green, and the north and
// east squares are darker shades, both to match the reference artwork.
//
// The palette is deliberately hard-coded and NOT themed: this is a fixed
// brand asset, so it must look identical in light mode, dark mode, and
// under a user-chosen accent (UI_GUIDELINES section 12a). It is the one
// place in the app where a raw hex is correct.
// ============================================================

@Component({
  selector: 'tp-brand-mark',
  standalone: true,
  imports: [],
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 100 100" fill="none"
         role="img" [attr.aria-label]="label() || null" [attr.aria-hidden]="label() ? null : 'true'">
      <!-- North arm -->
      <rect x="45" y="6"  width="10" height="36" rx="2.5" fill="#2b7cc4"/>
      <rect x="32" y="19" width="10" height="23" rx="2.5" fill="#2b7cc4"/>
      <rect x="19" y="26" width="10" height="16" rx="2.5" fill="#2b7cc4"/>
      <rect x="32" y="6"  width="10" height="10" rx="2.5" fill="#2b3190"/>
      <!-- East arm -->
      <rect x="58" y="45" width="36" height="10" rx="2.5" fill="#f0592b"/>
      <rect x="58" y="32" width="23" height="10" rx="2.5" fill="#f0592b"/>
      <rect x="58" y="19" width="16" height="10" rx="2.5" fill="#f0592b"/>
      <rect x="84" y="32" width="10" height="10" rx="2.5" fill="#e8412b"/>
      <!-- South arm -->
      <rect x="45" y="58" width="10" height="36" rx="2.5" fill="#2b7cc4"/>
      <rect x="58" y="58" width="10" height="23" rx="2.5" fill="#3fa535"/>
      <rect x="71" y="58" width="10" height="16" rx="2.5" fill="#3fa535"/>
      <rect x="58" y="84" width="10" height="10" rx="2.5" fill="#3fa535"/>
      <!-- West arm -->
      <rect x="6"  y="45" width="36" height="10" rx="2.5" fill="#7b2d8e"/>
      <rect x="19" y="58" width="23" height="10" rx="2.5" fill="#7b2d8e"/>
      <rect x="26" y="71" width="16" height="10" rx="2.5" fill="#7b2d8e"/>
      <rect x="6"  y="58" width="10" height="10" rx="2.5" fill="#7b2d8e"/>
    </svg>
  `,
  styles: `
    :host { display: inline-flex; line-height: 0; }
  `,
})
export class BrandMarkComponent {
  /** Rendered box size in px. The mark is square. */
  readonly size = input(32);
  /**
   * Accessible name. Leave empty when the mark sits next to the wordmark
   * (the text already names it) so screen readers don't announce it twice.
   */
  readonly label = input('');
}
