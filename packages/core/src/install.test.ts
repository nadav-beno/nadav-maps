import { describe, expect, it } from 'vitest';
import { detectInstall, shouldOfferInstall } from './install.ts';

const UA = {
  iphoneSafari17:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  // Safari 26 freezes the OS version at 18_6; only Version/ tells it apart.
  iphoneSafari26:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1',
  iphoneChromeOld:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/110.0.5481.83 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 326.0.3.30.91 (iPhone14,5; iOS 17_4; he_IL; he; scale=3.00; 1170x2532; 584123456)',
  iphoneFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/460.0.0.36.106;FBBV/580000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.4;FBSS/3;FBCR/;FBID/phone;FBLC/he_IL;FBOP/5]',
  iphoneGoogleApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/312.0.624827410 Mobile/15E148 Safari/604.1',
  iphoneBareWebView:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
};

describe('detectInstall', () => {
  it('iPhone Safari: share sheet steps, mobile', () => {
    const r = detectInstall({ userAgent: UA.iphoneSafari17 });
    expect(r).toMatchObject({ os: 'ios', device: 'iphone', browser: 'safari', inApp: null, method: 'ios-safari', mobile: true });
    expect(r.iosVersion).toBe(17.4);
  });

  it('reads the Safari version when iOS freezes the OS version (Safari 26)', () => {
    expect(detectInstall({ userAgent: UA.iphoneSafari26 }).iosVersion).toBe(26);
  });

  it('already on the home screen', () => {
    expect(detectInstall({ userAgent: UA.iphoneSafari17, standalone: true }).method).toBe('installed');
    expect(detectInstall({ userAgent: UA.androidChrome, displayModeStandalone: true, canPrompt: true }).method).toBe('installed');
  });

  it('iPad in desktop mode is still iOS', () => {
    const r = detectInstall({ userAgent: UA.ipadDesktopMode, platform: 'MacIntel', maxTouchPoints: 5 });
    expect(r).toMatchObject({ os: 'ios', device: 'ipad', method: 'ios-safari' });
  });

  it('Chrome, Firefox on iOS 16.4+ use their own share menu; older ones go to Safari', () => {
    expect(detectInstall({ userAgent: UA.iphoneChrome })).toMatchObject({ browser: 'chrome', method: 'ios-browser-share' });
    expect(detectInstall({ userAgent: UA.iphoneFirefox })).toMatchObject({ browser: 'firefox', method: 'ios-browser-share' });
    expect(detectInstall({ userAgent: UA.iphoneChromeOld }).method).toBe('open-in-safari');
  });

  it('in-app browsers on iOS must open the page in Safari', () => {
    expect(detectInstall({ userAgent: UA.iphoneInstagram })).toMatchObject({ inApp: 'instagram', method: 'open-in-safari' });
    expect(detectInstall({ userAgent: UA.iphoneFacebook })).toMatchObject({ inApp: 'facebook', method: 'open-in-safari' });
    expect(detectInstall({ userAgent: UA.iphoneGoogleApp })).toMatchObject({ inApp: 'google', method: 'open-in-safari' });
    expect(detectInstall({ userAgent: UA.iphoneBareWebView })).toMatchObject({ inApp: 'webview', method: 'open-in-safari' });
  });

  it('Android: our button when the browser offers a prompt, otherwise its menu; webviews go to the browser', () => {
    expect(detectInstall({ userAgent: UA.androidChrome, canPrompt: true })).toMatchObject({ os: 'android', method: 'prompt', mobile: true });
    expect(detectInstall({ userAgent: UA.androidChrome }).method).toBe('browser-menu');
    expect(detectInstall({ userAgent: UA.androidSamsung })).toMatchObject({ browser: 'samsung', method: 'browser-menu' });
    expect(detectInstall({ userAgent: UA.androidWebView })).toMatchObject({ inApp: 'webview', method: 'open-in-browser' });
  });

  it('desktop: prompt in Chrome, Add to Dock in Safari, menu elsewhere; never mobile', () => {
    expect(detectInstall({ userAgent: UA.winChrome, canPrompt: true })).toMatchObject({ method: 'prompt', mobile: false });
    expect(detectInstall({ userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 })).toMatchObject({ os: 'mac', method: 'mac-safari' });
    expect(detectInstall({ userAgent: UA.winFirefox })).toMatchObject({ browser: 'firefox', method: 'browser-menu', mobile: false });
  });
});

describe('shouldOfferInstall', () => {
  const safari = detectInstall({ userAgent: UA.iphoneSafari17 });
  it('from the second visit, once', () => {
    expect(shouldOfferInstall(safari, { visits: 1, shown: false })).toBe(false);
    expect(shouldOfferInstall(safari, { visits: 2, shown: false })).toBe(true);
    expect(shouldOfferInstall(safari, { visits: 5, shown: true })).toBe(false);
  });
  it('not on desktop, not when installed, not when only the browser menu can do it', () => {
    expect(shouldOfferInstall(detectInstall({ userAgent: UA.winChrome, canPrompt: true }), { visits: 3, shown: false })).toBe(false);
    expect(shouldOfferInstall(detectInstall({ userAgent: UA.iphoneSafari17, standalone: true }), { visits: 3, shown: false })).toBe(false);
    expect(shouldOfferInstall(detectInstall({ userAgent: UA.androidChrome }), { visits: 3, shown: false })).toBe(false);
    expect(shouldOfferInstall(detectInstall({ userAgent: UA.androidChrome, canPrompt: true }), { visits: 3, shown: false })).toBe(true);
    expect(shouldOfferInstall(detectInstall({ userAgent: UA.iphoneInstagram }), { visits: 2, shown: false })).toBe(true);
  });
});
