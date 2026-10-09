# Nadav Maps

מפה פתוחה לציבור הרחב, בנויה על [MapLibre GL JS](https://maplibre.org/) ונתוני [OpenStreetMap](https://www.openstreetmap.org/) דרך [OpenFreeMap](https://openfreemap.org/). אין צורך במפתחות API.

## הרצה מקומית

```bash
npm install
npm run dev
```

## בנייה

```bash
npm run build   # בדיקת טיפוסים ובנייה לתיקיית dist
```

## פרסום

כל push ל-`main` נבנה ומתפרסם אוטומטית ל-GitHub Pages דרך `.github/workflows/deploy.yml`.
בפעם הראשונה צריך להפעיל ב-GitHub: Settings → Pages → Source: **GitHub Actions**.

## מבנה

- `index.html` דף הכניסה
- `src/main.ts` יצירת המפה
- `src/style.css` עיצוב
- `public/` קבצים סטטיים
