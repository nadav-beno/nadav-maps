import { back, Icon, type ViewProps } from '@nm/core/app';
import { locPermission, motionPermission, requestLocation, requestMotion, type PermState } from './index.tsx';

const STATE: Record<PermState, string> = { granted: 'מאושר', denied: 'חסום', ask: 'עוד לא אושר' };

function Row({ icon, title, sub, state, onAsk }: { icon: string; title: string; sub: string; state: PermState; onAsk: () => void }) {
  return (
    <div class="list-item perm-row">
      <span class="li-icon">
        <Icon name={icon} size={20} />
      </span>
      <span class="li-body">
        <div class="li-title">{title}</div>
        <div class="li-sub">
          <span class={`perm-state perm-${state}`}>{STATE[state]}</span> · {sub}
        </div>
      </span>
      {state !== 'granted' && (
        <button class="btn small" onClick={onAsk}>
          אישור
        </button>
      )}
    </div>
  );
}

/**
 * What the app may use on this device, with a button to ask again and how to allow it for good.
 * A web app cannot grant permissions to itself: only the phone's settings can make "allow" permanent.
 */
export function PermissionsView(_: ViewProps) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return (
    <div class="view prose">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <h2>הרשאות מיקום ותנועה</h2>
      </header>
      <Row icon="my_location" title="מיקום" sub="הנקודה הכחולה, ניווט ומסלולים ממך" state={locPermission.value} onAsk={requestLocation} />
      <Row icon="explore" title="חיישני תנועה" sub="לאן הטלפון מכוון, ומצב מצפן" state={motionPermission.value} onAsk={() => void requestMotion()} />
      <p>
        אחרי שמאשרים פעם אחת, האפליקציה זוכרת את זה: המיקום נדלק לבד בכל פתיחה, וחיישני התנועה מתחברים בנגיעה הראשונה במסך.
      </p>
      {ios ? (
        <>
          <h3 class="section-title">כדי שהאייפון לא ישאל שוב</h3>
          <p class="muted small">אתר או אפליקציית רשת לא יכולים לאשר הרשאות בעצמם. רק אתם יכולים, פעם אחת, בהגדרות:</p>
          <ol>
            <li>
              הגדרות ← פרטיות ואבטחה ← שירותי מיקום ← <b>אתרי Safari</b> ← <b>בזמן השימוש ביישום</b>, ולהדליק <b>מיקום מדויק</b>.
            </li>
            <li>
              הגדרות ← אפליקציות ← Safari ← בחלק "הגדרות לאתרים" ← <b>מיקום</b> ← <b>אפשר</b>.
            </li>
            <li>
              ב-Safari, באתר הזה: כפתור <b>aA</b> (או ⋯) ליד הכתובת ← הגדרות אתר ← מיקום ← <b>אפשר</b>.
            </li>
          </ol>
          <p class="muted small">
            לחיישני התנועה אין באייפון הגדרה קבועה לאתרים. אם האייפון שואל שוב אחרי שהאפליקציה נסגרה, מספיק לאשר בחלון שקופץ בנגיעה הראשונה.
          </p>
        </>
      ) : (
        <>
          <h3 class="section-title">כדי שהדפדפן לא ישאל שוב</h3>
          <p class="muted small">
            לחצו על סמל המנעול (או ההגדרות) ליד הכתובת ← הרשאות האתר ← מיקום ← <b>אפשר</b>. באנדרואיד: הגדרות ← אפליקציות ← Chrome ← הרשאות ← מיקום ←{' '}
            <b>אפשר רק בזמן השימוש באפליקציה</b>.
          </p>
        </>
      )}
      <p class="muted small">המיקום נשאר במכשיר. אנחנו לא שומרים אותו ולא שולחים אותו לשרתים שלנו.</p>
    </div>
  );
}
