export const ACTIVE_DAYS = [1, 2, 3, 4, 6];
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday'];

export const TUTOR_PALETTES = [
  { bg: '#fef3c7', border: '#f59e0b', text: '#78350f', tag: '#d97706' },
  { bg: '#ffedd5', border: '#fb923c', text: '#7c2d12', tag: '#ea580c' },
  { bg: '#ede9fe', border: '#a78bfa', text: '#4c1d95', tag: '#7c3aed' },
  { bg: '#dbeafe', border: '#60a5fa', text: '#1e3a8a', tag: '#2563eb' },
  { bg: '#fce7f3', border: '#f472b6', text: '#831843', tag: '#db2777' },
  { bg: '#e2e8f0', border: '#64748b', text: '#0f172a', tag: '#334155' },
];

type TutorPalette = (typeof TUTOR_PALETTES)[number];

const NON_GREEN_HUES = Array.from({ length: 360 }, (_, hue) => hue).filter(
  (hue) => hue < 70 || hue > 200
);
const HUE_STEP = 97;

const dynamicTutorPalette = (index: number): TutorPalette => {
  const hue = NON_GREEN_HUES[(index * HUE_STEP) % NON_GREEN_HUES.length];
  return {
    bg: `hsl(${hue} 85% 94%)`,
    border: `hsl(${hue} 68% 64%)`,
    text: `hsl(${hue} 68% 25%)`,
    tag: `hsl(${hue} 72% 38%)`,
  };
};

export function getTutorPaletteByIndex(index: number): TutorPalette {
  if (index < TUTOR_PALETTES.length) return TUTOR_PALETTES[index];
  return dynamicTutorPalette(index);
}

export function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const startMonth = weekStart.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
  const startDay = weekStart.getDate();
  const endDay = end.getDate();
  const year = end.getFullYear();
  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}–${endDay}, ${year}`;
  }
  return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
}