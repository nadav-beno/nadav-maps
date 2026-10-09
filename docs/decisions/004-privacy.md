# 004: Privacy by default

- Location is used only on the device. Our server logs carry tool name, status and duration; never coordinates or text.
- Photos never leave the device (IndexedDB); only thumbnails and EXIF position are stored.
- Saved places live on the device until accounts exist; sharing a list encodes it into the link itself.
- Error reporting (Sentry) is off unless `VITE_SENTRY_DSN` is set, and strips URLs' query and hash.
