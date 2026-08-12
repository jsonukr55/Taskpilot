// ============================================================
// Admin sections — the "one thing at a time" panels of the Admin center.
// The section MENU lives in the sidebar (Admin expands like Organizations);
// the admin page shows a single section, chosen via the `?s=` query param.
// Shared here so the sidebar and the admin page never drift.
// ============================================================

export type AdminScope = 'platform' | 'org' | 'both';

export interface AdminSection {
  key:   string;   // matches the `?s=` query param + the page's @switch case
  label: string;
  icon:  string;   // registered tp-icon name
  scope: AdminScope;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { key: 'clients',   label: 'Clients',        icon: 'briefcase',    scope: 'platform' },
  { key: 'orgs',      label: 'Organizations',  icon: 'grid',         scope: 'platform' },
  { key: 'members',   label: 'Members',        icon: 'users',        scope: 'both' },
  { key: 'footprint', label: 'Data footprint', icon: 'layers',       scope: 'platform' },
  { key: 'archived',  label: 'Archived',       icon: 'trash-2',      scope: 'platform' },
];

/** Sections visible for the current scope (platform admin vs org admin). */
export function adminSectionsFor(isPlatform: boolean): AdminSection[] {
  return ADMIN_SECTIONS.filter(s => s.scope === 'both' || s.scope === (isPlatform ? 'platform' : 'org'));
}
