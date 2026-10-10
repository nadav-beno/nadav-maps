/**
 * "Install as an app" without an app store: which way of adding the web app to the home
 * screen applies to this browser. Pure (takes the browser facts as input) so it is unit tested.
 */

export interface InstallEnv {
  userAgent: string;
  /** navigator.platform ('MacIntel' on iPad in desktop mode). */
  platform?: string;
  maxTouchPoints?: number;
  /** navigator.standalone (iOS Safari, true when opened from the home screen icon). */
  standalone?: boolean;
  /** matchMedia('(display-mode: standalone)') or similar. */
  displayModeStandalone?: boolean;
  /** A `beforeinstallprompt` event was captured (Chrome, Edge, Samsung Internet). */
  canPrompt?: boolean;
}

export type InstallOs = 'ios' | 'android' | 'mac' | 'other';

/** Apps whose built-in browser cannot add to the home screen. */
export type InAppBrowser =
  | 'instagram' | 'facebook' | 'messenger' | 'gmail' | 'google' | 'linkedin' | 'twitter' | 'tiktok'
  | 'snapchat' | 'telegram' | 'line' | 'wechat' | 'pinterest' | 'webview';

export type InstallMethod =
  /** Already running from the home screen. */
  | 'installed'
  /** Our own button: the browser handed us its install prompt. */
  | 'prompt'
  /** iPhone/iPad Safari: Share -> Add to Home Screen -> Add. */
  | 'ios-safari'
  /** Chrome/Edge/Firefox on iOS 16.4+: the same, from that browser's share button. */
  | 'ios-browser-share'
  /** In-app browser, or another iOS browser too old to install: open the page in Safari first. */
  | 'open-in-safari'
  /** Android in-app browser: open the page in Chrome first. */
  | 'open-in-browser'
  /** Safari on macOS 14+: File -> Add to Dock. */
  | 'mac-safari'
  /** Anything else: the browser's own menu (Install app / Add to home screen), if it has one. */
  | 'browser-menu';

export interface InstallInfo {
  os: InstallOs;
  /** iPhone or iPad (iPad changes where the share button is). */
  device: 'iphone' | 'ipad' | 'other';
  browser: 'safari' | 'chrome' | 'firefox' | 'edge' | 'samsung' | 'opera' | 'other';
  inApp: InAppBrowser | null;
  /** iOS major.minor as a number (16.4 -> 16.4); for Safari 26+ the Safari version (iOS freezes the OS one at 18.6). */
  iosVersion: number | null;
  method: InstallMethod;
  /** Phones and tablets: worth an unprompted, one-time install hint. */
  mobile: boolean;
}

const IN_APP: [RegExp, InAppBrowser][] = [
  [/Instagram/i, 'instagram'],
  [/FBAN\/Messenger|MessengerForiOS|FB_IAB\/Orca|\bOrcaAndroid/i, 'messenger'],
  [/FBAN|FBAV|FB_IAB|FBIOS|\[FB/i, 'facebook'],
  [/LinkedInApp/i, 'linkedin'],
  [/Twitter|TwitterAndroid/i, 'twitter'],
  [/musical_ly|BytedanceWebview|TikTok|trill_/i, 'tiktok'],
  [/Snapchat/i, 'snapchat'],
  [/Telegram/i, 'telegram'],
  [/\bLine\//, 'line'],
  [/MicroMessenger/i, 'wechat'],
  [/Pinterest/i, 'pinterest'],
  [/GSA\//, 'google'],
];

function ver(s: string | undefined): number | null {
  if (!s) return null;
  // iOS minor versions stay below 10, so "16_4" -> 16.4 compares correctly.
  const [maj, min = '0'] = s.split(/[._]/);
  const n = Number(`${Number(maj)}.${Number(min)}`);
  return Number.isFinite(n) ? n : null;
}

export function detectInstall(env: InstallEnv): InstallInfo {
  const ua = env.userAgent;
  const iPadDesktop = env.platform === 'MacIntel' && (env.maxTouchPoints ?? 0) > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || iPadDesktop;
  const android = !ios && /Android/i.test(ua);
  const mac = !ios && /Macintosh|Mac OS X/.test(ua);
  const os: InstallOs = ios ? 'ios' : android ? 'android' : mac ? 'mac' : 'other';
  const device = ios ? (/iPad/.test(ua) || iPadDesktop ? 'ipad' : 'iphone') : 'other';

  const browser: InstallInfo['browser'] =
    /CriOS|Chrome\//.test(ua) && !/EdgiOS|EdgA|Edg\/|OPR|OPiOS|SamsungBrowser/.test(ua)
      ? 'chrome'
      : /EdgiOS|EdgA|Edg\//.test(ua)
        ? 'edge'
        : /FxiOS|Firefox\//.test(ua)
          ? 'firefox'
          : /SamsungBrowser/.test(ua)
            ? 'samsung'
            : /OPR|OPiOS|Opera/.test(ua)
              ? 'opera'
              : /Safari\//.test(ua) || (ios && /Version\//.test(ua))
                ? 'safari'
                : 'other';

  let inApp: InAppBrowser | null = null;
  for (const [re, id] of IN_APP) {
    if (re.test(ua)) {
      inApp = id;
      break;
    }
  }
  // Gmail and other apps use a bare WKWebView: an iOS user agent without the "Safari/" token
  // (Chrome, Firefox and Edge on iOS all keep it).
  if (!inApp && ios && !/Safari\//.test(ua)) inApp = /GoogleMail|Gmail/i.test(ua) ? 'gmail' : 'webview';
  // Android System WebView marks itself with "; wv)".
  if (!inApp && android && /; wv\)/.test(ua)) inApp = 'webview';

  let iosVersion: number | null = null;
  if (ios) {
    const osVer = ver(/OS (\d+[_.]\d+)/.exec(ua)?.[1]);
    const safariVer = browser === 'safari' ? ver(/Version\/(\d+(?:\.\d+)?)/.exec(ua)?.[1]) : null;
    iosVersion = Math.max(osVer ?? 0, safariVer ?? 0) || null;
  }

  const standalone = env.standalone === true || env.displayModeStandalone === true;
  let method: InstallMethod;
  if (standalone) method = 'installed';
  else if (env.canPrompt && !ios) method = 'prompt';
  else if (ios) {
    if (inApp) method = 'open-in-safari';
    else if (browser === 'safari') method = 'ios-safari';
    // Since iOS 16.4 other browsers can add web apps to the home screen from their share menu.
    else if (['chrome', 'edge', 'firefox'].includes(browser) && (iosVersion ?? 0) >= 16.4) method = 'ios-browser-share';
    else method = 'open-in-safari';
  } else if (android && inApp) method = 'open-in-browser';
  else if (mac && browser === 'safari' && (ver(/Version\/(\d+(?:\.\d+)?)/.exec(ua)?.[1]) ?? 0) >= 17) method = 'mac-safari';
  else method = 'browser-menu';

  return { os, device, browser, inApp, iosVersion, method, mobile: ios || android };
}

/** Hebrew name of an in-app browser, for "you are inside Instagram". */
export const IN_APP_NAME: Record<InAppBrowser, string> = {
  instagram: 'אינסטגרם',
  facebook: 'פייסבוק',
  messenger: 'מסנג׳ר',
  gmail: 'Gmail',
  google: 'אפליקציית Google',
  linkedin: 'לינקדאין',
  twitter: 'X (טוויטר)',
  tiktok: 'טיקטוק',
  snapchat: 'סנאפצ׳ט',
  telegram: 'טלגרם',
  line: 'LINE',
  wechat: 'WeChat',
  pinterest: 'פינטרסט',
  webview: 'אפליקציה',
};

/** Methods worth an unprompted hint (the others need the browser's menu or are done). */
const HINTED: InstallMethod[] = ['prompt', 'ios-safari', 'ios-browser-share', 'open-in-safari', 'open-in-browser'];

/**
 * Whether to show the one-time install hint: phones and tablets only, from the second visit
 * (a first-time visitor from a shared link came for the map, not for an app), and never again
 * once it has been shown.
 */
export function shouldOfferInstall(info: InstallInfo, state: { visits: number; shown: boolean }): boolean {
  return info.mobile && HINTED.includes(info.method) && state.visits >= 2 && !state.shown;
}
