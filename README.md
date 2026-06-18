# omega Meal Planner

A maintainable GitHub Pages-ready meal planner for omega-3-forward family meals.

## What is included

- `index.html` — page structure and tab layout
- `assets/css/styles.css` — visual styling, mobile layout, flip cards
- `assets/js/app.js` — meal planning logic, API calls, tracking, ratio planner
- `data/recipes.json` — 50 starter recipes with ingredients, steps, serving count, prep time, and estimated omega-6:omega-3 ratio
- `assets/img/recipe-placeholder.svg` — local fallback image

## Key updates

- Recipe Library uses flip cards: front has image/title/ratio; back has ingredients, steps, prep time, and serving count.
- Weekly Calendar now uses compact flippable cards for each recommended meal.
- Day column is narrowed so recipe cards get most of the calendar space.
- The ratio slider rebuilds the weekly meal plan around the target ratio and slightly favours omega-3.
- Imported Spoonacular recipes now estimate omega-6:omega-3 ratio from nutrition data when available, then fall back to a weighted ingredient heuristic.
- UI naming is kept consistent around “omega” and “omega ratio.”

## Local testing

Because the app loads `data/recipes.json`, do not open `index.html` directly as a `file://` URL. Run a simple local server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## API notes

This static version includes browser-side API keys for testing. For public production use, move API calls behind a small serverless function or backend proxy.

Used APIs:

- USDA FoodData Central for nutrient lookup
- Spoonacular for ingredient search and related recipe import
- recipe-scrapers-js for experimental URL import, subject to browser/CORS limitations
