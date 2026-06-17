# Omega Meal Planner

A static, GitHub Pages-ready omega-3-forward meal planner.

## Files

- `index.html` — app shell and tab structure
- `assets/css/styles.css` — layout, responsive design, flip cards
- `assets/js/app.js` — app logic, APIs, charts, ratio-based meal planning
- `data/recipes.json` — 50 starter recipes
- `assets/img/recipe-placeholder.svg` — default card image

## What is included

- Left navigation converted into tabs
- Ingredients quadrant grid
- Recipe Library with 50 starter recipes
- Flip-card recipe UI
- Manual recipe creation
- Ratio-driven weekly plan recommendations
- “I'm Feeling Lucky” weekly meal rebuild
- Spoonacular ingredient search
- Ingredient → related recipe → import to library flow
- USDA FoodData Central nutrient lookup
- recipe-scrapers URL import attempt
- LocalStorage for custom recipes, current plan, ratio target, and completion log

## API keys

This static version includes API keys in browser JavaScript because it is designed for quick testing on GitHub Pages.

For production, move API requests to a backend or serverless proxy so keys are not exposed.

## Local development

Because the app loads `data/recipes.json`, open it through a local server rather than double-clicking the HTML file:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## GitHub Pages

Upload the full folder contents to a GitHub repository and enable Pages from the repository root.
