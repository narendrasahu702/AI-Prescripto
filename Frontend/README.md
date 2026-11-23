# Prescripto AI Frontend (React + Tailwind CSS)

This is the complete frontend folder based on the supplied Prescripto source. It keeps the existing API calls and portal flows, with Tailwind CSS configured and responsive utility/component-layer rules for dashboard grids, forms, sidebar scrolling, focus states and mobile layouts.

## Requirements
- Node.js 18+
- The Prescripto backend running at `http://localhost:5000`

## Run
```bash
npm install
npm run dev
```
Open `http://localhost:5173`.

## Backend URL
Optional `.env` in this `Frontend` folder:
```env
VITE_API_URL=http://localhost:5000/api
```
Restart Vite after changing `.env`.

## Notes
- Keep the backend terminal running separately.
- Do not commit backend secrets or `.env` files.
- The Tailwind setup uses `tailwind.config.js` and `postcss.config.js`; the component layer in `src/style.css` uses Tailwind `@apply` utilities. The existing bespoke illustration/brand styles are retained to avoid changing the supplied app's visual identity and API behavior.
