# Omega Nudge Mobile

A net-new, mobile-first prototype for a family-of-four omega meal-planning workflow.

## Product defaults

- Household: family of four adults
- Recipe servings: 4
- Lunch logic: Sunday–Thursday dinners can become next-day packed lunch
- Default target: 4:1 omega-6:omega-3
- Ratio display: always omega-6:omega-3
- Recommendations: top 10 packed lunches + top 10 weeknight dinners
- Scoring: 70% omega/accessibility, 30% family behaviour/practicality
- Shopping list: toggle by store or by recipe
- Reset: Review & Reset after Friday 9pm

## Files

```txt
index.html
assets/css/styles.css
assets/js/app.js
assets/img/recipe-placeholder.svg
data/ingredients.json
data/recipes.json
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

Do not open the file directly with `file://`, because browsers may block JSON loading.

## API note

This version is intentionally built without hard dependency on paid APIs. It uses local JSON datasets first. Future API layers can be added behind a serverless proxy for:

- USDA FoodData Central nutrient lookup
- Open Food Facts packaged-food lookup
- Spoonacular or TheMealDB recipe search
- Google Places / MapKit local grocer discovery

Do not place production API keys in public GitHub Pages JavaScript.
