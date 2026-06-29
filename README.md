# Omega Meal Planner v3

Mobile-first meal planning prototype for omega-3-forward family meal planning.

## What changed in v3

- Recommended recipes are selectable.
- Selected recipes generate a shopping list.
- Shopping list items show 2+ likely grocers per ingredient.
- Shopping list tracks item status: needed, bought, not on shelf, too expensive, substituted, skipped.
- Weekly calendar recipe cards are flippable.
- Weekly calendar tracks completed and undone recipes with reasons.
- Omega ratio slider rebuilds recommendations and the weekly plan.
- Weekly history archives before the Friday 9pm reset.
- If the app is closed at Friday 9pm, the reset runs the next time the site opens.
- New maintainability files:
  - `data/grocers.json`
  - `data/reasons.json`

## File structure

```txt
index.html
assets/css/styles.css
assets/js/app.js
assets/img/recipe-placeholder.svg
data/recipes.json
data/grocers.json
data/reasons.json
```

## Local testing

Run from this folder:

```bash
python3 -m http.server 8000
```

Then open:

```txt
http://localhost:8000
```

Do not open `index.html` directly from Finder because browsers may block loading `data/*.json` from `file://`.

## Notes

This is still a static prototype. API keys in browser JavaScript are visible to users. For production, move USDA, Spoonacular, and recipe-scraping calls behind a serverless backend or proxy.
