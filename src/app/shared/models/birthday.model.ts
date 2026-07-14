// ============================================================
// Team birthdays — recur every year, so only month/day are stored.
// Shown as an annual marker in the Calendar week view.
// ============================================================

export interface Birthday {
  name:  string;
  day:   number;   // 1–31
  month: number;   // 1–12
}

export const TEAM_BIRTHDAYS: Birthday[] = [
  { name: 'Vikrant Thakur',   day: 29, month: 8 },
  { name: 'Rashika Varshney', day: 25, month: 12 },
  { name: 'Dhananjay Kumar Gupta',  day: 19, month: 7 }
];

/** Names with a birthday on the given month (1–12) and day. */
export function birthdaysOn(month: number, day: number): string[] {
  return TEAM_BIRTHDAYS.filter(b => b.month === month && b.day === day).map(b => b.name);
}
