import {
  Component, inject, input, computed, signal, effect, untracked,
  OnDestroy, HostListener
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { GroupService } from '@core/services/group.service';
import { NoteService } from '@core/services/note.service';
import { NoteAccessService } from '@core/services/note-access.service';
import { AuthService } from '@core/services/auth.service';
import { AiService } from '@core/services/ai.service';
import { environment } from '@env/environment';
import { IconComponent } from '@shared/components/icon/icon.component';
import { EditableBlockDirective } from './editable-block.directive';
import { CommentThreadComponent } from '../comment-thread/comment-thread.component';
import {
  NoteBlock, NoteBlockType, NoteBlockAssignee, BlockAccessRole,
  newBlock, BLOCK_TYPE_LABELS, blockAssignees
} from '@shared/models/note.model';
import { groupMembers, GroupMember } from '@shared/models/group.model';

// Markdown shortcuts, longest prefix first so '## ' wins over '# '.
const MD_SHORTCUTS: Array<[string, NoteBlockType]> = [
  ['### ', 'h3'], ['## ', 'h2'], ['# ', 'h1'],
  ['- ', 'bulleted'], ['* ', 'bulleted'],
  ['1. ', 'numbered'],
  ['[] ', 'todo'], ['[ ] ', 'todo'],
  ['> ', 'quote']
];

interface Pos { x: number; y: number; }

@Component({
  selector:   'tp-note-editor',
  standalone: true,
  imports:    [RouterLink, DragDropModule, IconComponent, EditableBlockDirective, CommentThreadComponent],
  templateUrl: './note-editor.component.html',
  styleUrl:    './note-editor.component.scss'
})
export class NoteEditorComponent implements OnDestroy {
  groupId = input<string>('');           // empty → personal (top-level) note
  noteId  = input.required<string>();

  readonly groups = inject(GroupService);
  readonly notes  = inject(NoteService);
  readonly access = inject(NoteAccessService);
  private readonly auth = inject(AuthService);
  private readonly ai   = inject(AiService);

  // Open/re-open the note whenever the route params change. An effect (not
  // ngOnInit) because /notes/A → /notes/B reuses this component — only the
  // inputs change, ngOnInit never re-runs. flushAll first so pending edits
  // of the previous note aren't lost (they carry their own note ids).
  private readonly openNoteRef = effect(() => {
    const gid = this.gid();
    const id  = this.noteId();
    untracked(() => {
      void this.notes.flushAll();
      this.notes.openNote(gid, id);
    });
  }, { allowSignalWrites: true });

  // Record "recently opened" once per note (activeNote re-emits on every
  // remote snapshot; the guard keeps this to a single write per visit).
  private lastRecordedId: string | null = null;
  private readonly recordOpenRef = effect(() => {
    const n = this.note();
    if (n && n.id === this.noteId() && n.id !== this.lastRecordedId) {
      this.lastRecordedId = n.id;
      // untracked: recordOpen writes the access-state signal; this effect
      // must neither throw (NG0600) nor subscribe to that state.
      untracked(() => this.access.recordOpen(n));
    }
  }, { allowSignalWrites: true });

  readonly BLOCK_TYPE_LABELS = BLOCK_TYPE_LABELS;
  readonly TYPE_MENU: NoteBlockType[] = ['paragraph', 'h1', 'h2', 'h3', 'bulleted', 'numbered', 'todo', 'quote', 'callout', 'divider'];

  // AI "skills" offered in the selection menu.
  //  mode 'replace' → rewrite the focused block in place.
  //  mode 'insert'  → add new block(s) below, preserving the original.
  //  insertAs shapes the inserted output (single callout, a bulleted/todo
  //  list parsed from lines, or mixed 'lines' → paragraphs + bullets).
  readonly AI_ACTIONS: Array<{ key: string; label: string; icon: string; instruction: string; mode: 'replace' | 'insert'; insertAs?: 'callout' | 'bulleted' | 'todo' | 'lines' }> = [
    { key: 'improve',      label: 'Improve writing',        icon: 'sparkles',     mode: 'replace', instruction: 'Improve the writing: make it clearer, more polished and fluent while preserving the original meaning and language.' },
    { key: 'grammar',      label: 'Fix spelling & grammar', icon: 'check-circle', mode: 'replace', instruction: 'Correct all spelling, grammar and punctuation mistakes. Keep the wording and meaning otherwise unchanged.' },
    { key: 'rewrite',      label: 'Rewrite',                icon: 'repeat',       mode: 'replace', instruction: 'Rewrite this text in a fresh way while preserving its meaning and language.' },
    { key: 'professional', label: 'Professional tone',      icon: 'user',         mode: 'replace', instruction: 'Rewrite this text in a professional, formal business tone.' },
    { key: 'shorter',      label: 'Make shorter',           icon: 'zap',          mode: 'replace', instruction: 'Make this text shorter and more concise while keeping the key points.' },
    { key: 'longer',       label: 'Make longer',            icon: 'plus',         mode: 'replace', instruction: 'Expand this text with more detail and explanation.' },
    { key: 'translate',    label: 'Translate…',             icon: 'message-square', mode: 'replace', instruction: '' },
    { key: 'paragraph',    label: 'To paragraph',           icon: 'type',         mode: 'replace', instruction: 'Rewrite this as one or more flowing prose paragraphs. Remove any list or bullet formatting.' },
    { key: 'bullets',      label: 'To bullet points',       icon: 'list',         mode: 'insert', insertAs: 'bulleted', instruction: 'Rewrite the key points of this text as a concise bulleted list. Output each point on its own line beginning with "- ".' },
    { key: 'summarize',    label: 'Summarize',              icon: 'file-text',    mode: 'insert', insertAs: 'callout',  instruction: 'Summarize this text in one or two concise sentences.' },
    { key: 'actions',      label: 'Extract action items',   icon: 'check-square', mode: 'insert', insertAs: 'todo',     instruction: 'Extract the concrete action items or tasks from this text. Output each as its own line beginning with "- ". If there are none, output a single line: "No action items".' },
    { key: 'meeting',      label: 'Meeting summary',        icon: 'users',        mode: 'insert', insertAs: 'lines',    instruction: 'Summarize this as concise meeting notes with short lines. Prefix any decisions or action items with "- ".' },
    { key: 'email',        label: 'Draft email',            icon: 'send',         mode: 'insert', insertAs: 'lines',    instruction: 'Draft a professional email based on this content: include a subject line, greeting, body and sign-off. Use short lines; prefix any list items with "- ".' },
    { key: 'explain',      label: 'Explain',                icon: 'message-circle', mode: 'insert', insertAs: 'callout', instruction: 'Explain what this text means in simple, plain language.' },
  ];
  readonly aiBusy = signal<string | null>(null);
  readonly aiEnabled = environment.features.ai;
  readonly copied = signal(false);

  // ---- Derived ----
  readonly isPersonal = computed(() => !this.groupId());
  readonly gid        = computed<string | null>(() => this.groupId() || null); // for NoteService paths
  readonly group   = computed(() => this.groupId() ? this.groups.getGroupById(this.groupId()) : undefined);
  readonly canEdit = computed(() => this.isPersonal() ? true : this.groups.canEditGroup(this.group()));
  readonly isOwner = computed(() => this.isPersonal() ? true : this.groups.isOwner(this.group()));
  readonly members = computed<GroupMember[]>(() => { const g = this.group(); return g ? groupMembers(g) : []; });
  readonly note    = computed(() => this.notes.activeNote());

  readonly commentCounts = computed(() => {
    const map = new Map<string, number>();
    for (const c of this.notes.comments()) {
      if (c.resolved) continue;
      map.set(c.blockId, (map.get(c.blockId) ?? 0) + 1);
    }
    return map;
  });

  // ---- Local editing state ----
  readonly localBlocks    = signal<NoteBlock[]>([]);
  readonly titleDraft     = signal('');
  readonly focusedBlockId = signal<string | null>(null);
  readonly selectedBlockId = signal<string | null>(null); // comment panel anchor

  // ---- Floating UI state ----
  readonly bubble       = signal<Pos | null>(null);     // selection toolbar
  readonly slashFor     = signal<string | null>(null);  // block id with an open slash menu
  readonly slashQuery   = signal('');
  readonly slashPos     = signal<Pos>({ x: 0, y: 0 });
  readonly blockMenuFor = signal<string | null>(null);  // ⋮⋮ menu
  readonly blockMenuPos = signal<Pos>({ x: 0, y: 0 });
  readonly assignFor    = signal<string | null>(null);  // assignee popover
  readonly assignPos    = signal<Pos>({ x: 0, y: 0 });
  readonly dateFor      = signal<string | null>(null);  // date picker popover
  readonly datePos      = signal<Pos>({ x: 0, y: 0 });

  readonly slashOptions = computed(() => {
    const q = this.slashQuery();
    return this.TYPE_MENU.filter(t => BLOCK_TYPE_LABELS[t].toLowerCase().includes(q));
  });

  readonly anyMenuOpen = computed(() =>
    !!this.blockMenuFor() || !!this.assignFor() || !!this.slashFor() || !!this.dateFor()
  );

  private lastNoteId = '';

  // ---- Undo / redo history ----
  private undoStack: Array<{ blocks: NoteBlock[]; title: string }> = [];
  private redoStack: Array<{ blocks: NoteBlock[]; title: string }> = [];
  private lastRecordAt = 0;
  private lastRecordWasText = false;

  // ---- Live-edit recency (so an idle-focused line still accepts a peer's edit) ----
  private editingBlockId: string | null = null;
  private editingAt = 0;
  private static readonly TYPING_GRACE_MS = 1500;

  constructor() {
    // Reconcile remote note → local blocks, preserving the block being typed in.
    effect(() => {
      const note = this.notes.activeNote();
      if (!note) return;
      untracked(() => {
        const focused = this.focusedBlockId();
        const local   = this.localBlocks();
        const typingNow = !!focused
          && this.editingBlockId === focused
          && (Date.now() - this.editingAt) < NoteEditorComponent.TYPING_GRACE_MS;

        // A peer changed the line I'm idly parked in → release focus so its DOM repaints.
        if (focused && !typingNow) {
          const rb = note.blocks.find(b => b.id === focused);
          const lb = local.find(b => b.id === focused);
          if (rb && lb && rb.html !== lb.html) {
            (document.activeElement as HTMLElement)?.blur?.();
            this.focusedBlockId.set(null);
          }
        }

        const keep = this.focusedBlockId();   // may have just been cleared above
        const preserve = typingNow ? keep : null;
        const merged = note.blocks.map(rb => {
          if (rb.id === preserve) {
            // Keep what the user is actively typing; only accept a remote assignee change.
            const lb = local.find(b => b.id === rb.id);
            return lb ? { ...lb, assigneeId: rb.assigneeId ?? null } : rb;
          }
          return rb;
        });
        this.localBlocks.set(merged);
        if (note.id !== this.lastNoteId) {
          this.lastNoteId = note.id;
          this.titleDraft.set(note.title);
          this.undoStack = [];
          this.redoStack = [];
        }
      });
    }, { allowSignalWrites: true });
  }

  ngOnDestroy(): void {
    void this.notes.flushAll();
    this.notes.closeNote();
  }

  // ---- Undo / redo ----
  @HostListener('keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    if (k === 'z' && !ev.shiftKey)      { ev.preventDefault(); this.undo(); }
    else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); this.redo(); }
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.applySnapshot(this.undoStack.pop()!);
  }
  redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.applySnapshot(this.redoStack.pop()!);
  }

  private snapshot(): { blocks: NoteBlock[]; title: string } {
    return { blocks: structuredClone(this.localBlocks()), title: this.titleDraft() };
  }

  /** Push the current state onto the undo stack. Consecutive text edits coalesce into one step. */
  private recordSnapshot(isTextEdit: boolean): void {
    const now = Date.now();
    const coalesce = isTextEdit && this.lastRecordWasText && (now - this.lastRecordAt) < 700;
    if (!coalesce) {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > 120) this.undoStack.shift();
      this.redoStack = [];
    }
    this.lastRecordAt = now;
    this.lastRecordWasText = isTextEdit;
  }

  private applySnapshot(s: { blocks: NoteBlock[]; title: string }): void {
    (document.activeElement as HTMLElement)?.blur?.();  // let the directive repaint every block
    this.focusedBlockId.set(null);
    this.closeMenus();
    this.titleDraft.set(s.title);
    this.localBlocks.set(s.blocks);
    void this.notes.updateNote(this.gid(), this.noteId(), { blocks: s.blocks, title: s.title });
    this.lastRecordWasText = false;  // don't coalesce across an undo/redo
  }

  // ---- Glyph + markdown hint shown in menus (Notion-style) ----
  typeGlyph(t: NoteBlockType): string {
    return { paragraph: 'T', h1: 'H1', h2: 'H2', h3: 'H3', bulleted: '•', numbered: '1.', todo: '☑', quote: '❝', callout: '💡', divider: '—' }[t];
  }
  mdHint(t: NoteBlockType): string {
    return { paragraph: '', h1: '#', h2: '##', h3: '###', bulleted: '-', numbered: '1.', todo: '[]', quote: '"', callout: '', divider: '---' }[t];
  }
  typeDesc(t: NoteBlockType): string {
    return {
      paragraph: 'Just start writing with plain text.',
      h1: 'Big section heading.',
      h2: 'Medium section heading.',
      h3: 'Small section heading.',
      bulleted: 'Create a simple bulleted list.',
      numbered: 'Create a numbered list.',
      todo: 'Track tasks with a checklist.',
      quote: 'Capture a quote.',
      callout: 'Make writing stand out in a box.',
      divider: 'Visually divide blocks.'
    }[t];
  }
  initial = (name: string): string => (name?.charAt(0) || '?').toUpperCase();

  // ---- Title ----
  onTitleInput(value: string): void {
    this.recordSnapshot(true);
    this.titleDraft.set(value);
    this.notes.queueSave(this.gid(), this.noteId(), { title: value });
  }

  // ---- Block persistence helpers ----
  private setBlocks(next: NoteBlock[]): void {
    // Text edits (same block structure) coalesce into one undo step; structural changes don't.
    const cur = this.localBlocks();
    const sameStructure = cur.length === next.length
      && cur.every((b, i) => b.id === next[i].id && b.type === next[i].type);
    this.recordSnapshot(sameStructure);
    this.localBlocks.set(next);
    this.notes.queueSave(this.gid(), this.noteId(), { blocks: next });
  }
  private patchBlock(id: string, patch: Partial<NoteBlock>): void {
    this.setBlocks(this.localBlocks().map(b => b.id === id ? { ...b, ...patch } : b));
  }

  onInput(block: NoteBlock, html: string): void {
    this.editingBlockId = block.id;
    this.editingAt = Date.now();
    this.patchBlock(block.id, { html });
    if (this.applyMarkdown(block.id, html)) return;

    // Slash menu: triggered by a leading '/'
    const text = stripTags(html);
    if (text.startsWith('/')) {
      this.slashQuery.set(text.slice(1).toLowerCase());
      this.slashFor.set(block.id);
      const r = this.caretRect();
      this.slashPos.set({ x: r.left, y: r.bottom + 6 });
    } else if (this.slashFor() === block.id) {
      this.slashFor.set(null);
    }
  }

  onBlur(): void { void this.notes.flush(this.noteId()); }

  private applyMarkdown(id: string, html: string): boolean {
    const current = this.localBlocks().find(b => b.id === id);
    if (!current || current.type !== 'paragraph') return false;
    const text = stripTags(html);
    for (const [prefix, type] of MD_SHORTCUTS) {
      if (text.startsWith(prefix)) {
        const stripped = html.replace(prefix, '');
        this.patchBlock(id, { type, html: stripped, ...(type === 'todo' ? { checked: false } : {}) });
        this.setBlockDom(id, stripped);
        return true;
      }
    }
    return false;
  }

  toggleCheck(block: NoteBlock): void {
    this.patchBlock(block.id, { checked: !block.checked });
  }

  // ---- Keyboard ----
  onEnter(ev: Event, block: NoteBlock, index: number): void {
    ev.preventDefault();

    // If the slash menu is open, Enter picks the first option.
    if (this.slashFor() === block.id) {
      const opt = this.slashOptions()[0];
      if (opt) this.chooseSlash(opt);
      return;
    }

    const isList = block.type === 'bulleted' || block.type === 'numbered' || block.type === 'todo';
    const empty  = stripTags(block.html).trim().length === 0;

    if (isList && empty) {
      this.patchBlock(block.id, { type: 'paragraph' });
      this.setBlockDom(block.id, block.html);
      return;
    }

    const nb = newBlock(isList ? block.type : 'paragraph', '');
    const next = [...this.localBlocks()];
    next.splice(index + 1, 0, nb);
    this.setBlocks(next);
    this.focusBlock(nb.id);
  }

  onBackspace(ev: Event, block: NoteBlock, index: number): void {
    if (this.slashFor() === block.id && this.slashQuery() === '') this.slashFor.set(null);
    if (index === 0 || !this.isCaretAtStart()) return;
    ev.preventDefault();

    const blocks = this.localBlocks();
    const prev = blocks[index - 1];

    // Backspacing into a divider just removes the divider; keep the current line.
    if (prev.type === 'divider') {
      this.setBlocks(blocks.filter(b => b.id !== prev.id));
      this.focusBlock(block.id);
      return;
    }

    const mergedHtml = (prev.html ?? '') + (block.html ?? '');
    const next = blocks
      .map(b => b.id === prev.id ? { ...b, html: mergedHtml } : b)
      .filter(b => b.id !== block.id);
    this.setBlocks(next);
    this.setBlockDom(prev.id, mergedHtml);
  }

  onEscape(): void { this.closeMenus(); }

  onPaste(ev: ClipboardEvent): void {
    ev.preventDefault();
    const text = ev.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  }

  // ---- Nesting (Tab / Shift+Tab) ----
  onTabKey(ev: Event, block: NoteBlock, outdent: boolean): void {
    ev.preventDefault();
    const next = Math.max(0, Math.min(5, (block.indent ?? 0) + (outdent ? -1 : 1)));
    if (next === (block.indent ?? 0)) return;
    this.patchBlock(block.id, { indent: next });
    this.focusBlock(block.id);
  }

  /** Bullet glyph rotates by nesting level, like Notion. */
  bulletChar(indent = 0): string {
    return ['•', '◦', '▪'][indent % 3];
  }

  /** Ordinal for a numbered item among its consecutive same-indent siblings. */
  numberFor(index: number): number {
    const blocks = this.localBlocks();
    const curIndent = blocks[index].indent ?? 0;
    let n = 1;
    for (let i = index - 1; i >= 0; i--) {
      const bi = blocks[i].indent ?? 0;
      if (bi > curIndent) continue;                                   // deeper nested — skip
      if (blocks[i].type === 'numbered' && bi === curIndent) { n++; continue; }
      break;                                                          // sequence ended
    }
    return n;
  }

  // ---- Drag to reorder ----
  onDrop(event: CdkDragDrop<NoteBlock[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const next = [...this.localBlocks()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.setBlocks(next);
  }

  // ---- Selection (bubble) toolbar ----
  @HostListener('document:selectionchange')
  onSelectionChange(): void {
    if (!this.canEdit()) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { this.bubble.set(null); return; }
    const node = sel.anchorNode;
    const host = node instanceof Element ? node : node?.parentElement;
    if (!host?.closest('[data-block-id]')) { this.bubble.set(null); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { this.bubble.set(null); return; }
    this.bubble.set({ x: rect.left + rect.width / 2, y: rect.bottom + 8 });
  }

  format(cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough'): void {
    document.execCommand(cmd);
    this.syncFocused();
  }
  toggleCode(): void {
    const text = window.getSelection()?.toString() ?? '';
    if (!text) return;
    document.execCommand('insertHTML', false, `<code>${escapeHtml(text)}</code>`);
    this.syncFocused();
  }
  addLink(): void {
    const url = prompt('Link URL');
    if (url) document.execCommand('createLink', false, url);
    this.syncFocused();
    this.bubble.set(null);
  }
  bubbleComment(): void {
    const id = this.focusedBlockId();
    this.bubble.set(null);
    if (id) this.openComments(id);
  }

  // ---- "Turn into" nested hover submenu ----
  readonly turnIntoSub = signal<Pos | null>(null);
  private subTimer?: ReturnType<typeof setTimeout>;

  openTurnIntoSub(ev: MouseEvent): void {
    clearTimeout(this.subTimer);
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.turnIntoSub.set({ x: r.right - 6, y: r.top - 6 });
  }
  scheduleCloseSub(): void {
    this.subTimer = setTimeout(() => this.turnIntoSub.set(null), 160);
  }
  keepSub(): void { clearTimeout(this.subTimer); }

  turnIntoFromSub(type: NoteBlockType): void {
    const id = this.focusedBlockId();
    this.turnIntoSub.set(null);
    this.bubble.set(null);
    if (id) this.turnInto(id, type);
  }

  /** Run a Groq-powered "skill" on the selection (or the whole line if nothing selected). */
  async runAi(action: { key: string; instruction: string; mode: 'replace' | 'insert'; insertAs?: 'callout' | 'bulleted' | 'todo' | 'lines' }): Promise<void> {
    const id = this.focusedBlockId();
    const block = id ? this.localBlocks().find(b => b.id === id) : null;
    if (!id || !block) return;
    const selected = window.getSelection()?.toString().trim() ?? '';
    const source = selected || stripTags(block.html);
    if (!source.trim()) { this.bubble.set(null); return; }

    // Translate needs a target language chosen at run time.
    let instruction = action.instruction;
    if (action.key === 'translate') {
      const lang = prompt('Translate to which language?', 'Spanish');
      if (!lang?.trim()) { this.bubble.set(null); return; }
      instruction = `Translate this text into ${lang.trim()}. Output only the translation, preserving meaning, tone and any list structure.`;
    }

    this.aiBusy.set(action.key);
    try {
      const result = (await this.ai.transformText(instruction, source)).trim();
      if (!result) return;

      if (action.mode === 'replace') {
        const html = textToHtml(result);
        this.patchBlock(id, { html });
        this.setBlockDom(id, html);
      } else {
        this.insertResultBlocks(id, result, action.insertAs ?? 'callout');
      }
    } catch {
      alert('AI request failed. Check your connection and try again.');
    } finally {
      this.aiBusy.set(null);
      this.bubble.set(null);
    }
  }

  /**
   * Insert AI output as new block(s) directly below `afterId`, never
   * touching existing blocks (so no formatting is lost):
   *  - 'callout'          → one callout block
   *  - 'bulleted'/'todo'  → one list block per line
   *  - 'lines'            → bulleted for bullet lines, paragraphs otherwise
   */
  private insertResultBlocks(afterId: string, result: string, insertAs: 'callout' | 'bulleted' | 'todo' | 'lines'): void {
    const blocks = this.localBlocks();
    const idx = blocks.findIndex(b => b.id === afterId);
    if (idx < 0) return;

    let created: NoteBlock[];
    if (insertAs === 'callout') {
      created = [newBlock('callout', textToHtml(result))];
    } else if (insertAs === 'bulleted' || insertAs === 'todo') {
      const lines = splitLines(result);
      created = (lines.length ? lines : [result]).map(l => newBlock(insertAs, textToHtml(stripBullet(l))));
    } else {
      created = splitLines(result).map(l =>
        isBulletLine(l) ? newBlock('bulleted', textToHtml(stripBullet(l))) : newBlock('paragraph', textToHtml(l))
      );
      if (!created.length) created = [newBlock('paragraph', textToHtml(result))];
    }

    const next = [...blocks];
    next.splice(idx + 1, 0, ...created);
    this.setBlocks(next);
    this.focusBlock(created[created.length - 1].id);
  }

  private syncFocused(): void {
    const id = this.focusedBlockId();
    if (!id) return;
    const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
    if (el) this.patchBlock(id, { html: el.innerHTML });
  }

  /** Copy the whole note (title + structure) to the clipboard as rich HTML + markdown. */
  async copyNote(): Promise<void> {
    const title  = this.titleDraft();
    const blocks = this.localBlocks();
    const html   = buildNoteHtml(title, blocks);
    const text   = buildNoteMarkdown(title, blocks);
    try {
      if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html':  new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1800);
    } catch {
      alert('Copy failed — your browser blocked clipboard access.');
    }
  }

  // ---- Slash menu ----
  chooseSlash(type: NoteBlockType): void {
    const id = this.slashFor();
    if (!id) return;
    this.slashFor.set(null);

    if (type === 'divider') {
      // Divider holds no text — drop one in and land the caret on a fresh line below.
      const blocks = this.localBlocks();
      const idx = blocks.findIndex(b => b.id === id);
      const para = newBlock('paragraph', '');
      const next = blocks.map(b => b.id === id ? { ...b, type: 'divider' as NoteBlockType, html: '' } : b);
      next.splice(idx + 1, 0, para);
      this.setBlocks(next);
      this.focusBlock(para.id);
      return;
    }

    this.patchBlock(id, { type, html: '', ...(type === 'todo' ? { checked: false } : {}) });
    this.setBlockDom(id, '');
  }

  // ---- Left gutter ----
  // '+' inserts a block below and opens the block-type menu (like Notion).
  addBelow(index: number, ev: MouseEvent): void {
    ev.stopPropagation();
    const nb = newBlock('paragraph', '');
    const next = [...this.localBlocks()];
    next.splice(index + 1, 0, nb);
    this.setBlocks(next);
    this.focusBlock(nb.id);

    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.blockMenuFor.set(null);
    this.assignFor.set(null);
    this.slashQuery.set('');
    this.slashPos.set({ x: r.right + 6, y: r.top });
    this.slashFor.set(nb.id);
  }

  openBlockMenu(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.blockMenuPos.set({ x: r.left, y: r.bottom + 4 });
    this.assignFor.set(null);
    this.blockMenuFor.set(this.blockMenuFor() === id ? null : id);
  }

  turnInto(id: string, type: NoteBlockType): void {
    this.patchBlock(id, { type, ...(type === 'todo' ? { checked: false } : {}) });
    this.blockMenuFor.set(null);
    this.focusBlock(id);
  }

  deleteBlock(id: string): void {
    const blocks = this.localBlocks();
    if (blocks.length <= 1) {
      this.patchBlock(id, { type: 'paragraph', html: '', assigneeId: null });
      this.setBlockDom(id, '');
    } else {
      const idx = blocks.findIndex(b => b.id === id);
      const focusTarget = (blocks[idx - 1] ?? blocks[idx + 1]).id;
      this.setBlocks(blocks.filter(b => b.id !== id));
      this.focusBlock(focusTarget);
    }
    this.blockMenuFor.set(null);
  }

  // ---- Assignment + per-line access ----
  assigneesOf(block: NoteBlock): Array<{ member: GroupMember; role: BlockAccessRole }> {
    const members = this.members();
    return blockAssignees(block)
      .map(a => ({ member: members.find(m => m.userId === a.userId), role: a.role }))
      .filter((x): x is { member: GroupMember; role: BlockAccessRole } => !!x.member);
  }

  /** Current user's per-line role on a block, or null if not assigned. */
  myBlockRole(block: NoteBlock): BlockAccessRole | null {
    const uid = this.auth.userId();
    return uid ? (blockAssignees(block).find(a => a.userId === uid)?.role ?? null) : null;
  }

  /** A line is editable if you can edit the group AND you're not assigned as viewer on it.
   *  The owner is never locked out of their own group's content. */
  canEditBlock(block: NoteBlock): boolean {
    if (this.isOwner()) return true;
    return this.canEdit() && this.myBlockRole(block) !== 'viewer';
  }

  roleOnBlock(blockId: string, uid: string): BlockAccessRole | null {
    const b = this.localBlocks().find(x => x.id === blockId);
    return b ? (blockAssignees(b).find(a => a.userId === uid)?.role ?? null) : null;
  }

  openAssign(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.assignPos.set({ x: Math.max(12, r.right - 240), y: r.bottom + 4 });
    this.blockMenuFor.set(null);
    this.assignFor.set(this.assignFor() === id ? null : id);
  }

  /** Toggle a member's assignment/role on a line. Clicking the active role clears it. */
  assign(id: string, uid: string, role: BlockAccessRole): void {
    const block = this.localBlocks().find(b => b.id === id);
    if (!block) return;
    const current = blockAssignees(block);
    const existing = current.find(a => a.userId === uid);

    let assignees: NoteBlockAssignee[];
    if (existing && existing.role === role) {
      assignees = current.filter(a => a.userId !== uid);           // toggle off
    } else if (existing) {
      assignees = current.map(a => a.userId === uid ? { userId: uid, role } : a); // change role
    } else {
      assignees = [...current, { userId: uid, role }];             // add
    }

    const next = this.localBlocks().map(b => b.id === id ? { ...b, assignees, assigneeId: null } : b);
    this.recordSnapshot(false);
    this.localBlocks.set(next);
    void this.notes.updateNote(this.gid(), this.noteId(), { blocks: next });
    // Keep the popover open so multiple people can be set at once.
  }

  // ---- Per-line date ----
  openDate(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.datePos.set({ x: Math.max(12, r.right - 220), y: r.bottom + 4 });
    this.blockMenuFor.set(null);
    this.assignFor.set(null);
    this.dateFor.set(this.dateFor() === id ? null : id);
  }
  blockDateValue(id: string): string {
    return this.localBlocks().find(b => b.id === id)?.date ?? '';
  }
  blockDateLabel(block: NoteBlock): string {
    if (!block.date) return '';
    const d = new Date(block.date + 'T00:00:00');
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  setBlockDate(id: string, value: string | null): void {
    const date = value || null;
    const next = this.localBlocks().map(b => b.id === id ? { ...b, date } : b);
    this.recordSnapshot(false);
    this.localBlocks.set(next);
    void this.notes.updateNote(this.gid(), this.noteId(), { blocks: next });
    this.dateFor.set(null);
  }

  // ---- Comments ----
  openComments(blockId: string): void {
    this.closeMenus();
    this.selectedBlockId.set(blockId);
  }
  blockPreview(blockId: string): string {
    const b = this.localBlocks().find(x => x.id === blockId);
    return b ? stripTags(b.html).slice(0, 40) : '';
  }

  // ---- Menu management ----
  closeMenus(): void {
    this.blockMenuFor.set(null);
    this.assignFor.set(null);
    this.slashFor.set(null);
    this.dateFor.set(null);
  }
  onScroll(): void {
    this.bubble.set(null);
    this.closeMenus();
  }

  // ---- DOM / caret utilities ----
  private caretRect(): DOMRect {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height || r.top) return r;
    }
    return new DOMRect(240, 260, 0, 0);
  }
  private focusBlock(id: string): void {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      if (!el) return;
      el.focus();
      this.caretToEnd(el);
    });
  }
  private setBlockDom(id: string, html: string): void {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      if (!el) return;
      el.innerHTML = html;
      el.focus();
      this.caretToEnd(el);
    });
  }
  private caretToEnd(el: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  private isCaretAtStart(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return false;
    const probe = range.cloneRange();
    const host = (range.startContainer as HTMLElement).parentElement?.closest('[data-block-id]')
      ?? (range.startContainer as HTMLElement);
    probe.selectNodeContents(host);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().length === 0;
  }
}

/** Strip HTML tags to plain text (for markdown detection & previews). */
function stripTags(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html ?? '';
  return tmp.textContent ?? '';
}

/** Escape HTML entities for safe insertion. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plain text → block HTML (escaped, newlines become <br>). */
function textToHtml(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br>');
}

/** Split AI output into non-empty trimmed lines. */
function splitLines(s: string): string[] {
  return s.split('\n').map(l => l.trim()).filter(Boolean);
}

/** Does the line start with a bullet / number marker? */
function isBulletLine(line: string): boolean {
  return /^([-*•]|\d+[.)])\s+/.test(line);
}

/** Remove a leading bullet / number marker from a line. */
function stripBullet(line: string): string {
  return line.replace(/^([-*•]|\d+[.)])\s+/, '').trim();
}

/** Serialize a note to rich HTML, grouping consecutive list items into <ul>/<ol>. */
function buildNoteHtml(title: string, blocks: NoteBlock[]): string {
  let out = title ? `<h1>${escapeHtml(title)}</h1>` : '';
  let i = 0;
  while (i < blocks.length) {
    const type = blocks[i].type;
    if (type === 'bulleted' || type === 'numbered' || type === 'todo') {
      const tag = type === 'numbered' ? 'ol' : 'ul';
      let items = '';
      while (i < blocks.length && blocks[i].type === type) {
        const b = blocks[i];
        items += type === 'todo'
          ? `<li>${b.checked ? '☑' : '☐'} ${b.html}</li>`
          : `<li>${b.html}</li>`;
        i++;
      }
      out += `<${tag}>${items}</${tag}>`;
      continue;
    }
    const b = blocks[i];
    switch (b.type) {
      case 'h1':      out += `<h1>${b.html}</h1>`; break;
      case 'h2':      out += `<h2>${b.html}</h2>`; break;
      case 'h3':      out += `<h3>${b.html}</h3>`; break;
      case 'quote':   out += `<blockquote>${b.html}</blockquote>`; break;
      case 'callout': out += `<p>💡 ${b.html}</p>`; break;
      case 'divider': out += `<hr>`; break;
      default:        out += `<p>${b.html || '<br>'}</p>`;
    }
    i++;
  }
  return out;
}

/** Serialize a note to Markdown (preserves headings, lists, indents, checkboxes). */
function buildNoteMarkdown(title: string, blocks: NoteBlock[]): string {
  const lines: string[] = [];
  if (title) { lines.push(`# ${title}`, ''); }
  let num = 0;
  for (const b of blocks) {
    if (b.type !== 'numbered') num = 0;
    const text = stripTags(b.html);
    switch (b.type) {
      case 'h1':      lines.push(`# ${text}`); break;
      case 'h2':      lines.push(`## ${text}`); break;
      case 'h3':      lines.push(`### ${text}`); break;
      case 'bulleted':lines.push(`- ${text}`); break;
      case 'numbered':lines.push(`${++num}. ${text}`); break;
      case 'todo':    lines.push(`- [${b.checked ? 'x' : ' '}] ${text}`); break;
      case 'quote':   lines.push(`> ${text}`); break;
      case 'callout': lines.push(`> 💡 ${text}`); break;
      case 'divider': lines.push('---'); break;
      default:        lines.push(text);
    }
  }
  return lines.join('\n');
}
