import { describe, expect, it } from 'vitest';
import {
  beaufort,
  fmtPrecip,
  fmtTemp,
  fmtVisibility,
  fmtWind,
  latticeFor,
  moonPhase,
  parseWeatherQuery,
  rampColor,
  renderField,
  sampleLattice,
  uvBand,
  visibilityLabel,
  WEATHER_RAMPS,
  weatherIcon,
  weatherScene,
  weatherText,
  windFrom,
} from './weather.ts';

describe('weather conditions', () => {
  it('names WMO codes in Hebrew, by day and night', () => {
    expect(weatherText(0)).toBe('בהיר');
    expect(weatherText(0, false)).toBe('לילה בהיר');
    expect(weatherText(2)).toBe('מעונן חלקית');
    expect(weatherText(63)).toBe('גשם');
    expect(weatherText(95)).toBe('סופת רעמים');
    expect(weatherText(null)).toBe('אין נתון');
  });
  it('picks icons and scenes', () => {
    expect(weatherIcon(0)).toBe('sunny');
    expect(weatherIcon(0, false)).toBe('moon_stars');
    expect(weatherIcon(73)).toBe('weather_snowy');
    expect(weatherIcon(85)).toBe('weather_snowy');
    expect(weatherIcon(61)).toBe('rainy');
    expect(weatherIcon(82)).toBe('rainy_heavy');
    expect(weatherIcon(53)).toBe('rainy_light');
    expect(weatherIcon(99)).toBe('thunderstorm');
    expect(weatherScene(3, false)).toBe('cloudy-night');
    expect(weatherScene(61)).toBe('rain');
    expect(weatherScene(45)).toBe('fog');
  });
});

describe('UV, wind, visibility', () => {
  it('uses the WHO UV bands', () => {
    expect(uvBand(1).label).toBe('נמוך');
    expect(uvBand(3).label).toBe('בינוני');
    expect(uvBand(7.9).label).toBe('גבוה');
    expect(uvBand(10).label).toBe('גבוה מאוד');
    expect(uvBand(11).label).toBe('קיצוני');
  });
  it('names where the wind comes from', () => {
    expect(windFrom(0)).toBe('צפונית');
    expect(windFrom(270)).toBe('מערבית');
    expect(windFrom(359)).toBe('צפונית');
    expect(windFrom(-90)).toBe('מערבית');
    expect(windFrom(null)).toBe('');
    expect(beaufort(0)).toBe(0);
    expect(beaufort(25)).toBe(4);
    expect(beaufort(130)).toBe(12);
  });
  it('describes visibility', () => {
    expect(visibilityLabel(500)).toBe('ערפל');
    expect(visibilityLabel(24000)).toBe('ראות מצוינת');
  });
});

describe('units', () => {
  it('formats metric and imperial', () => {
    expect(fmtTemp(21.6)).toBe('22°');
    expect(fmtTemp(0, 'imperial')).toBe('32°');
    expect(fmtTemp(null)).toBe('–');
    expect(fmtWind(16.09344, 'imperial')).toBe('10 mph');
    expect(fmtWind(12.4)).toBe('12 קמ״ש');
    expect(fmtPrecip(0.4)).toBe('0.4 מ״מ');
    expect(fmtPrecip(12)).toBe('12 מ״מ');
    expect(fmtVisibility(24140)).toBe('24 ק״מ');
    expect(fmtVisibility(2500)).toBe('2.5 ק״מ');
  });
});

describe('moon', () => {
  it('knows a full and a new moon', () => {
    // Full moon 2026-11-24, new moon 2026-11-09 (UTC, approx.).
    expect(moonPhase(Date.UTC(2026, 10, 24, 12)).name).toBe('ירח מלא');
    expect(moonPhase(Date.UTC(2026, 10, 9, 12)).name).toBe('מולד');
    expect(moonPhase(Date.UTC(2026, 10, 24, 12)).illumination).toBeGreaterThan(0.97);
  });
});

describe('lattice and colour field', () => {
  it('keeps the point count bounded and points on multiples of the step', () => {
    const l = latticeFor([34.2, 29.5, 35.9, 33.3], 160);
    expect(l.lngs.length * l.lats.length).toBeLessThanOrEqual(160);
    for (const v of [...l.lngs, ...l.lats]) expect(Math.abs(v / l.step - Math.round(v / l.step))).toBeLessThan(1e-6);
    expect(l.lngs[0]).toBeLessThan(34.2);
    expect(l.lats[l.lats.length - 1]).toBeGreaterThan(33.3);
    const world = latticeFor([-180, -85, 180, 85], 160);
    expect(world.step).toBe(16);
    const city = latticeFor([34.75, 32.05, 34.8, 32.1]);
    expect(city.step).toBe(0.125);
    expect(city.lngs.length).toBeGreaterThanOrEqual(3);
  });
  it('interpolates between points and skips missing ones', () => {
    const l = { step: 1, lngs: [0, 1], lats: [0, 1] };
    expect(sampleLattice(l, [[0, 10], [0, 10]], 0.5, 0.5)).toBeCloseTo(5);
    expect(sampleLattice(l, [[0, null], [0, null]], 0.9, 0.5)).toBeCloseTo(0);
    expect(sampleLattice(l, [[null, null], [null, null]], 0.5, 0.5)).toBeNull();
  });
  it('colours values along the ramp and paints a field', () => {
    expect(rampColor(WEATHER_RAMPS.uv, 0)).toEqual([78, 180, 0, 1]);
    expect(rampColor(WEATHER_RAMPS.precip, 0)[3]).toBe(0);
    expect(rampColor(WEATHER_RAMPS.temp, 100)).toEqual(WEATHER_RAMPS.temp[WEATHER_RAMPS.temp.length - 1][1]);
    const l = { step: 1, lngs: [0, 1], lats: [0, 1] };
    const px = renderField(l, [[20, 20], [20, 20]], WEATHER_RAMPS.temp, 4, 4);
    expect(px.length).toBe(64);
    expect(px[3]).toBe(255);
  });
});

describe('weather in the search box', () => {
  it('recognises weather questions', () => {
    expect(parseWeatherQuery('מזג אוויר')).toEqual({ place: '', candidates: [] });
    expect(parseWeatherQuery('מזג האוויר')).toEqual({ place: '', candidates: [] });
    expect(parseWeatherQuery('מזג אוויר בחיפה')?.candidates).toEqual(['חיפה', 'בחיפה']);
    expect(parseWeatherQuery('מזג אוויר תל אביב')?.candidates).toEqual(['תל אביב']);
    expect(parseWeatherQuery('מזג אוויר באר שבע')?.candidates[0]).toBe('באר שבע');
    expect(parseWeatherQuery('weather in London')?.candidates).toEqual(['London']);
    expect(parseWeatherQuery('קפה בתל אביב')).toBeNull();
    expect(parseWeatherQuery('weatherford')).toBeNull();
  });
});
