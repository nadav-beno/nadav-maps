/**
 * Fake Open-Meteo answers for e2e tests: a forecast for one point (current + 15-minute +
 * hourly + daily) and the hourly map-layer variables for many points. Times are around now.
 */

const hour = () => Math.floor(Date.now() / 3_600_000) * 3600;

export function omForecast(lat = 32.08, lng = 34.78) {
  const h0 = hour();
  const hours = Array.from({ length: 72 }, (_, i) => h0 - 24 * 3600 + i * 3600);
  const day0 = h0 - ((h0 + 2 * 3600) % 86400); // local midnight in Israel (UTC+2)
  const days = Array.from({ length: 10 }, (_, i) => day0 + i * 86400);
  const wave = (t: number) => Math.sin(((t / 3600 + 2 - 9) / 24) * 2 * Math.PI);
  return {
    latitude: lat,
    longitude: lng,
    elevation: 12,
    timezone: 'Asia/Jerusalem',
    utc_offset_seconds: 7200,
    current: {
      time: h0 + 900,
      temperature_2m: 23.4,
      relative_humidity_2m: 64,
      apparent_temperature: 24.8,
      is_day: 1,
      precipitation: 0,
      weather_code: 2,
      cloud_cover: 40,
      pressure_msl: 1014.2,
      wind_speed_10m: 14.6,
      wind_direction_10m: 285,
      wind_gusts_10m: 27,
      visibility: 24140,
      uv_index: 5.8,
      dew_point_2m: 16.1,
    },
    minutely_15: { time: Array.from({ length: 8 }, (_, i) => h0 + 900 * (i + 1)), precipitation: [0, 0, 0.2, 0.6, 0.4, 0.1, 0, 0] },
    hourly: {
      time: hours,
      temperature_2m: hours.map((t) => 20 + 5 * wave(t)),
      apparent_temperature: hours.map((t) => 21 + 5 * wave(t)),
      precipitation_probability: hours.map((_, i) => (i > 26 && i < 30 ? 60 : 5)),
      precipitation: hours.map((_, i) => (i > 26 && i < 30 ? 0.8 : 0)),
      weather_code: hours.map((_, i) => (i > 26 && i < 30 ? 61 : 2)),
      is_day: hours.map((t) => (((t / 3600 + 2) % 24) >= 6 && ((t / 3600 + 2) % 24) < 17 ? 1 : 0)),
      uv_index: hours.map((t) => Math.max(0, 8 * wave(t + 3 * 3600))),
      uv_index_clear_sky: hours.map((t) => Math.max(0, 9 * wave(t + 3 * 3600))),
      visibility: hours.map(() => 24140),
      wind_speed_10m: hours.map((t) => 12 + 4 * wave(t)),
      wind_direction_10m: hours.map(() => 285),
      wind_gusts_10m: hours.map((t) => 22 + 6 * wave(t)),
      relative_humidity_2m: hours.map((t) => 65 - 10 * wave(t)),
      dew_point_2m: hours.map(() => 16),
      pressure_msl: hours.map((_, i) => 1012 + i * 0.05),
      shortwave_radiation: hours.map((t) => Math.max(0, 700 * wave(t + 3 * 3600))),
      cloud_cover: hours.map(() => 40),
    },
    daily: {
      time: days,
      weather_code: days.map((_, i) => (i === 1 ? 61 : i === 4 ? 3 : 1)),
      temperature_2m_max: days.map((_, i) => 26 - (i % 4)),
      temperature_2m_min: days.map((_, i) => 17 - (i % 3)),
      precipitation_sum: days.map((_, i) => (i === 1 ? 3.2 : 0)),
      precipitation_probability_max: days.map((_, i) => (i === 1 ? 70 : 5)),
      sunrise: days.map((d) => d + 4 * 3600 + 15 * 60),
      sunset: days.map((d) => d + 14 * 3600 + 45 * 60),
      uv_index_max: days.map(() => 6.1),
      wind_speed_10m_max: days.map(() => 20),
      wind_gusts_10m_max: days.map(() => 35),
      wind_direction_10m_dominant: days.map(() => 280),
      daylight_duration: days.map(() => 37800),
    },
  };
}

export function omGrid(lats: number[], lngs: number[]) {
  const h0 = hour();
  const time = Array.from({ length: 48 }, (_, i) => h0 + i * 3600);
  return lats.map((lat, k) => {
    const lng = lngs[k];
    const base = 14 + (33 - lat) * 4 + (lng - 34.5) * 3 + 3 * Math.sin(lat * 7 + lng * 5);
    return {
      latitude: lat,
      longitude: lng,
      hourly: {
        time,
        temperature_2m: time.map((_, i) => base + 4 * Math.sin(i / 4)),
        precipitation: time.map((_, i) => Math.max(0, 6 * Math.sin(lat * 5 + lng * 3 + i / 3) - 2)),
        wind_speed_10m: time.map(() => 10 + 25 * Math.abs(Math.sin(lat * 4 + lng * 2))),
        wind_direction_10m: time.map(() => 260 + 30 * Math.sin(lat * 3)),
        uv_index: time.map((_, i) => Math.max(0, 3 + (33.5 - lat) * 2.5 + 2 * Math.sin(lng * 6) + 3 * Math.sin(i / 4))),
        cloud_cover: time.map(() => (k * 13) % 100),
        visibility: time.map(() => 15000 + (k % 3) * 5000),
        weather_code: time.map(() => 2),
      },
    };
  });
}
