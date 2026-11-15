import type { EnemyKind, PowerKind, UpgradeKind } from './engine.ts';

/** קפטן רום: our own character (drawn here), who hosts the game. */
export function CaptainFace({ size = 56, mood = 'smile' }: { size?: number; mood?: 'smile' | 'wow' | 'sad' }) {
  return (
    <svg class="captain-face" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="31" fill="#10243f" stroke="#4df3ff" stroke-width="2" />
      {/* neck and collar */}
      <path d="M18 64 C20 52 44 52 46 64 Z" fill="#2f6b4f" />
      <path d="M26 54 L32 60 L38 54" fill="none" stroke="#ffd54a" stroke-width="2" />
      {/* face */}
      <ellipse cx="32" cy="36" rx="13" ry="15" fill="#f1c7a0" />
      {/* helmet */}
      <path d="M17 33 C17 16 47 16 47 33 L47 28 C47 13 17 13 17 28 Z" fill="#dfe7ef" />
      <path d="M16 34 C14 18 50 18 48 34 C46 24 18 24 16 34 Z" fill="#c9d3dd" />
      <rect x="29" y="13" width="6" height="6" rx="2" fill="#ff4d6d" />
      {/* goggles on the forehead */}
      <rect x="19" y="23" width="11" height="7" rx="3.5" fill="#4df3ff" stroke="#1b3550" stroke-width="1.5" />
      <rect x="34" y="23" width="11" height="7" rx="3.5" fill="#4df3ff" stroke="#1b3550" stroke-width="1.5" />
      <path d="M30 26.5 H34" stroke="#1b3550" stroke-width="1.5" />
      {/* eyes */}
      {mood === 'wow' ? (
        <>
          <circle cx="26.5" cy="36" r="2.4" fill="#1b2330" />
          <circle cx="37.5" cy="36" r="2.4" fill="#1b2330" />
        </>
      ) : (
        <>
          <path d={mood === 'sad' ? 'M24 35 Q26.5 37 29 35' : 'M24 36 Q26.5 33.5 29 36'} stroke="#1b2330" stroke-width="2" fill="none" stroke-linecap="round" />
          <path d={mood === 'sad' ? 'M35 35 Q37.5 37 40 35' : 'M35 36 Q37.5 33.5 40 36'} stroke="#1b2330" stroke-width="2" fill="none" stroke-linecap="round" />
        </>
      )}
      {/* moustache and mouth */}
      <path d="M25 42 Q32 39 39 42 Q32 44 25 42 Z" fill="#8a5a3b" />
      {mood === 'wow' ? <ellipse cx="32" cy="46.5" rx="2.6" ry="3" fill="#7a2b2b" /> : <path d={mood === 'sad' ? 'M28 47.5 Q32 45 36 47.5' : 'M27 45.5 Q32 49.5 37 45'} stroke="#7a2b2b" stroke-width="2" fill="none" stroke-linecap="round" />}
    </svg>
  );
}

export const TUTORIAL: { text: string; next?: string }[] = [
  { text: 'ברוך הבא למשמרת, שומר! אני קפטן רום. רואה את המטוסים בעיגולים הירוקים? אלה טיסות אמיתיות שבאוויר מעל ישראל ממש עכשיו. התפקיד שלנו: שאף פולש לא יתקרב אליהן.', next: 'המשך' },
  { text: 'הנה פולש ראשון! גע בו כדי לשגר מיירט מאחד המגדלים למטה.' },
  { text: 'יפה! המיירט לוקח זמן לטוס. את הפולש המהיר הזה צריך לפגוש בדרך: גע בעיגול הזהוב, במקום שאליו הוא הולך.' },
  { text: 'שים לב לפסים הקטנים מתחת לכל מגדל: אלה המיירטים שנשארו. הם נטענים לאט, אז אל תבזבז.', next: 'הבנתי' },
  { text: 'הנה מטוס האספקה, החבר הזהוב שלנו! גע בו, והוא יפיל קפסולה עם מצנח. גע בקפסולה לפני שהיא נעלמת.' },
  { text: 'קיבלת מגן לכל הטיסות! ועכשיו הכלל הכי חשוב: אם פולש פוגע בטיסה, המשמרת נגמרת. מוכן? בהצלחה, שומר!', next: 'יאללה, מתחילים!' },
];

export const RETRY = ['קרוב! הוא חוזר, נסה שוב.', 'כמעט! עוד ניסיון.', 'לא נורא, באימון מותר לטעות.'];

export const NEW_KIND: Partial<Record<EnemyKind, string>> = {
  dart: 'זהירות, חיצי-צל! הם מהירים מאוד. גע רחוק לפניהם.',
  zigzag: 'הזיגזגים הגיעו. הם מתנדנדים, אז כוון לקו האמצע של התנועה.',
  armor: 'שריון! צריך שלוש פגיעות. התחל לירות עליו מוקדם.',
  splitter: 'מפצלים: כשפוגעים בהם הם מתפרקים לשלושה קטנים. תהיה מוכן לפיצוץ נוסף.',
  ghost: 'רפאים... נעלמים ומופיעים. הפיצוץ פוגע בהם גם כשלא רואים אותם.',
  jammer: 'משבש! הוא מסתיר את מי שלידו. תפיל אותו ראשון.',
  boss: 'ספינת אם בדרך! פגע בכל הנקודות הזוהרות שלה, ושמור על הטיסות מהקטנים שהיא שולחת.',
};

export const WAVE_LINES = ['גל חדש. אתה מסתדר מצוין.', 'שמור על הקצב, שומר.', 'עוד גל, עוד הצלה.', 'הטיסות סומכות עליך.', 'עיניים פתוחות, הם מגיעים.'];

export const SECTORS = ['גזרת המרכז', 'גזרת הצפון', 'גזרת ירושלים', 'גזרת הדרום', 'כל ישראל'];

export const TIPS: Record<EnemyKind, string> = {
  buzzer: 'טיפ: כוון קצת לפני הפולש, לא עליו.',
  mini: 'טיפ: הקטנים זריזים. פיצוץ אחד באמצע הקבוצה תופס כמה.',
  dart: 'טיפ: חיצי-צל מהירים. גע רחוק יותר לפניהם, על הקו שלהם.',
  zigzag: 'טיפ: בזיגזג כוון לקו האמצע של התנועה, לא לקצה.',
  armor: 'טיפ: שריון צריך שלוש פגיעות. התחל לירות עליו ברגע שהוא מופיע.',
  splitter: 'טיפ: אחרי מפצל, חכה רגע וירה פיצוץ אחד על שלושת הקטנים.',
  ghost: 'טיפ: רפאים נראים ליד הטיסה. אל תחכה לרגע האחרון.',
  jammer: 'טיפ: תפיל משבש ראשון, הוא מסתיר את כל מי שלידו.',
  boss: 'טיפ: ספינת האם איטית. קודם הקטנים, אחר כך הנקודות הזוהרות.',
};

export const POWER_NAME: Record<PowerKind, string> = {
  fast: 'טילים מהירים',
  shield: 'מגן לכל הטיסות',
  ammo: 'תחמושת בלי סוף',
  big: 'פיצוץ ענק',
  homing: 'מיירט מתביית',
  slow: 'הילוך איטי',
  life: 'הזדמנות שנייה',
  shock: 'גל הלם',
};

export const POWER_ICON: Record<PowerKind, string> = { fast: 'rocket_launch', shield: 'shield', ammo: 'bolt', big: 'local_fire_department', homing: 'my_location', slow: 'timer', life: 'favorite', shock: 'radar' };

export const UPGRADE_TEXT: Record<UpgradeKind, { title: string; text: string; icon: string }> = {
  speed: { title: 'מיירטים מהירים', text: '+15% מהירות לכל המיירטים', icon: 'rocket_launch' },
  blast: { title: 'פיצוץ רחב', text: '+15% לגודל הפיצוץ', icon: 'local_fire_department' },
  launcher: { title: 'משגר רביעי', text: 'מגדל נוסף באמצע המפה', icon: 'add' },
  reload: { title: 'טעינה מהירה', text: 'המגדלים נטענים מהר ב-20%', icon: 'timer' },
  guard: { title: 'מגן שומר', text: 'סופג פגיעה אחת בטיסה שמותקפת', icon: 'shield' },
  supply: { title: 'עוד אספקה', text: 'עוד מטוס אספקה בכל גל', icon: 'flight' },
  capacity: { title: 'מחסנית גדולה', text: '+2 מיירטים בכל מגדל', icon: 'bolt' },
};
