/**
 * All UI strings live here. Hebrew, modern, warm. See docs/VOICE.md.
 * Keys are stable identifiers; never put English UI text in screens directly.
 */
export const t = {
  app: {
    name: 'LexBites',
    tagline: 'ביס אחד ביום, אוצר מילים שלם',
  },
  tabs: {
    home: 'בית',
    learn: 'למידה',
    words: 'מילים',
    rivalry: 'יריבות',
    stats: 'סטטיסטיקה',
  },
  common: {
    continue: 'המשך',
    back: 'חזרה',
    cancel: 'ביטול',
    save: 'שמירה',
    done: 'סיימתי',
    close: 'סגירה',
    ok: 'אוקיי',
    yes: 'כן',
    no: 'לא',
    loading: 'רגע...',
    retry: 'ניסיון נוסף',
    settings: 'הגדרות',
    offline: 'אין אינטרנט, אבל הכול עובד גם ככה',
    soon: 'בקרוב',
  },
  pwa: {
    updateReady: 'יש גרסה חדשה. לרענן?',
    updateNow: 'לרענן',
    updateLater: 'אחר כך',
    offlineReady: 'האפליקציה מוכנה לעבודה גם בלי אינטרנט',
    installHint: 'כדי להתקין: שתף ← הוספה למסך הבית',
  },
  home: {
    comingSoon: 'עוד רגע מתחילים',
    comingSoonBody: 'LexBites בבנייה. כבר אפשר להוסיף למסך הבית, והלמידה מגיעה בקרוב.',
    install: 'איך מתקינים באייפון',
    installSteps: ['פותחים את הכתובת בספארי', 'לוחצים על כפתור השיתוף', 'בוחרים "הוספה למסך הבית"'],
  },
} as const;

export type Strings = typeof t;
