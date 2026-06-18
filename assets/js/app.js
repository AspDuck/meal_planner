const USDA_API_KEY = "6keAxhN4R8b5EA6nIGcKyZE7leHMdqCHBaKXwPVc";
const SPOONACULAR_API_KEY = "71002a06138446b69ad0a2228b0159d4";

const STORE = {
  recipes: "omegaMealPlanner.customRecipes",
  log: "omegaMealPlanner.completionLog",
  plan: "omegaMealPlanner.weeklyPlan",
  targetRatio: "omegaMealPlanner.targetRatio"
};

const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let recipes = [];
let completionLog = [];
let weeklyPlan = {};
let completionChart;
let ratioChart;
let ratioRebuildTimer;

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function safeJsonParse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function saveCustomRecipes() {
  const custom = recipes.filter(r => r.source !== "Starter recipe");
  localStorage.setItem(STORE.recipes, JSON.stringify(custom));
}

function saveLog() {
  localStorage.setItem(STORE.log, JSON.stringify(completionLog));
}

function savePlan() {
  localStorage.setItem(STORE.plan, JSON.stringify(weeklyPlan));
}

function classifyIngredient(name) {
  const lower = String(name).toLowerCase();
  const omega3Keywords = ["salmon", "mackerel", "sardine", "herring", "anchovy", "fish", "tuna", "flax", "chia", "purslane", "walnut", "mussel", "oyster", "clam", "trout", "cod", "halibut", "seaweed", "nori"];
  const omega6Keywords = ["corn oil", "soybean oil", "sunflower oil", "safflower oil", "cottonseed oil", "grapeseed oil", "seed oil", "pumpkin seed", "sunflower seed"];
  if (omega3Keywords.some(k => lower.includes(k))) return "omega3";
  if (omega6Keywords.some(k => lower.includes(k))) return "omega6";
  return "neutral";
}

function omegaWeightForIngredient(name) {
  const lower = String(name).toLowerCase();
  const has = terms => terms.some(term => lower.includes(term));
  const omega = { omega3: 0, omega6: 0 };

  if (has(["salmon", "sardine", "mackerel", "herring", "anchovy", "trout"])) omega.omega3 += 4.0;
  else if (has(["tuna", "halibut", "cod", "fish", "seafood"])) omega.omega3 += 2.2;
  if (has(["mussel", "oyster", "clam"])) omega.omega3 += 1.6;
  if (has(["chia", "flax", "purslane"])) omega.omega3 += 2.0;
  if (has(["walnut"])) { omega.omega3 += 1.4; omega.omega6 += 0.6; }
  if (has(["omega-3", "omega 3"])) omega.omega3 += 2.0;

  if (has(["sunflower oil", "soybean oil", "corn oil", "safflower oil", "cottonseed oil", "grapeseed oil", "seed oil"])) omega.omega6 += 4.0;
  if (has(["sunflower seed", "pumpkin seed", "sesame", "tahini", "peanut", "almond", "cashew"])) omega.omega6 += 1.6;
  if (has(["chicken", "beef", "pork", "lamb", "sausage", "bacon", "butter", "cheese", "cream"])) omega.omega6 += 0.7;
  if (has(["miso", "soy sauce", "soybean"])) omega.omega6 += 0.5;

  return omega;
}

function extractOmegaRatioFromNutrition(rawRecipe) {
  const nutrients = rawRecipe?.nutrition?.nutrients || rawRecipe?.nutrients || [];
  if (!Array.isArray(nutrients)) return null;

  let omega3 = 0;
  let omega6 = 0;

  nutrients.forEach(nutrient => {
    const name = String(nutrient.name || nutrient.title || "").toLowerCase();
    const amount = Number(nutrient.amount ?? nutrient.value ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (name.includes("omega") && (name.includes("3") || name.includes("alpha-linolenic") || name.includes("epa") || name.includes("dha"))) omega3 += amount;
    if (name.includes("omega") && name.includes("6")) omega6 += amount;
  });

  if (omega3 > 0 && omega6 >= 0) return Math.max(0.1, Math.min(8, omega6 / omega3));
  return null;
}

function estimateOmegaRatioFromIngredients(ingredientNames = [], fallbackMealType = "dinner") {
  let omega3 = fallbackMealType === "lunch" ? 0.35 : 0.25;
  let omega6 = fallbackMealType === "lunch" ? 0.45 : 0.65;

  ingredientNames.forEach(name => {
    const weights = omegaWeightForIngredient(name);
    omega3 += weights.omega3;
    omega6 += weights.omega6;
  });

  const ratio = omega6 / Math.max(omega3, 0.15);
  return Math.max(0.15, Math.min(8, ratio));
}

function omegaScoreFromRatio(ratio) {
  return Math.max(1, Math.min(10, Math.round((1 / (ratio + 0.15)) * 3)));
}

function ratioToString(r) {
  if (!r || !Number.isFinite(r)) return "1:∞";
  if (Math.abs(r - 1) < 0.05) return "1:1";
  if (r < 1) return `1:${(1 / r).toFixed(1)}`;
  return `${r.toFixed(1)}:1`;
}

function prepTimeLabel(recipe) {
  const minutes = recipe?.prepTimeMinutes || recipe?.readyInMinutes;
  if (minutes) return `${minutes} min`;
  return recipe?.mealType === "lunch" ? "15–20 min" : "30–45 min";
}

function getRecipe(id) {
  return recipes.find(r => r.id === id);
}

function recipeSearchBlob(recipe) {
  return [
    recipe.name,
    recipe.mealType,
    recipe.source,
    ...(recipe.tags || []),
    ...(recipe.ingredients || []).map(i => i.name)
  ].join(" ").toLowerCase();
}

function setActiveTab(tabId) {
  $$(".tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tabId));
  $$(".tab-section").forEach(section => section.classList.toggle("active", section.id === tabId));
}

function recipeIngredientsHtml(recipe, limit = Infinity) {
  const items = (recipe.ingredients || []).slice(0, limit);
  return items.map(i => `<li>${escapeHtml(i.name)} <span class="source-note">(${escapeHtml(i.category || "neutral")})</span></li>`).join("");
}

function recipeStepsHtml(recipe, limit = Infinity) {
  const items = (recipe.steps || []).slice(0, limit);
  return items.map(s => `<li>${escapeHtml(s)}</li>`).join("");
}

function renderRecipeCards() {
  const grid = $("#recipe-card-grid");
  const search = ($("#recipe-search")?.value || "").toLowerCase().trim();
  const type = $("#recipe-type-filter")?.value || "all";
  const sort = $("#recipe-sort")?.value || "name";

  let view = recipes.filter(recipe => {
    if (type !== "all" && recipe.mealType !== type) return false;
    if (search && !recipeSearchBlob(recipe).includes(search)) return false;
    return true;
  });

  view.sort((a, b) => {
    if (sort === "ratio") return (a.ratio || 999) - (b.ratio || 999);
    if (sort === "omegaScore") return (b.omegaScore || 0) - (a.omegaScore || 0);
    return a.name.localeCompare(b.name);
  });

  grid.innerHTML = view.map(recipe => `
    <article class="flip-card recipe-library-card" data-recipe-id="${escapeHtml(recipe.id)}" tabindex="0" role="button" aria-label="Flip ${escapeHtml(recipe.name)}">
      <div class="flip-inner">
        <div class="flip-front">
          <img class="recipe-img" src="${escapeHtml(recipe.image || "assets/img/recipe-placeholder.svg")}" alt="">
          <div class="flip-front-content">
            <h3>${escapeHtml(recipe.name)}</h3>
            <div class="recipe-meta">
              <span class="badge ${recipe.mealType === "lunch" ? "green" : "fall"}">${recipe.mealType === "lunch" ? "Packed lunch" : "Weeknight meal"}</span>
              <span class="badge gold">${recipe.servings || 4} servings</span>
              <span class="badge">ratio ${ratioToString(recipe.ratio)}</span>
            </div>
            <p class="source-note">Source: ${escapeHtml(recipe.source || "Unknown")}</p>
            <p class="muted">${escapeHtml((recipe.tags || []).slice(0, 4).join(" · ") || "Click to view ingredients and steps.")}</p>
            <button class="ghost view-details-btn" type="button">View ingredients & steps</button>
          </div>
        </div>
        <div class="flip-back">
          <h3>${escapeHtml(recipe.name)}</h3>
          <p class="source-note">Prep: ${prepTimeLabel(recipe)} · Serves ${recipe.servings || 4} · ratio ${ratioToString(recipe.ratio)}</p>
          <h4>Ingredients</h4>
          <ul>${recipeIngredientsHtml(recipe)}</ul>
          <h4>Steps</h4>
          <ol>${recipeStepsHtml(recipe)}</ol>
          <div class="btn-row">
            <button class="add-to-week-btn" data-recipe-id="${escapeHtml(recipe.id)}" type="button">Add to this week</button>
            <button class="ghost close-card-btn" type="button">Flip back</button>
          </div>
          ${recipe.url ? `<p><a href="${escapeHtml(recipe.url)}" target="_blank" rel="noopener">Open source recipe</a></p>` : ""}
        </div>
      </div>
    </article>
  `).join("");
}

function getTargetRatio() {
  return parseFloat(localStorage.getItem(STORE.targetRatio) || $("#ratio-slider")?.value || "2");
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function calculatePlanRatio(plan) {
  let total = 0;
  let count = 0;
  daysOfWeek.forEach(day => {
    ["lunch", "dinner"].forEach(meal => {
      const rec = getRecipe(plan[day]?.[meal]);
      if (rec) {
        total += Number(rec.ratio || 1);
        count++;
      }
    });
  });
  return count ? total / count : 0;
}

function calculateVarietyPenalty(plan) {
  const seen = new Map();
  let penalty = 0;
  let previousDinner = "";
  daysOfWeek.forEach(day => {
    const lunch = plan[day]?.lunch;
    const dinner = plan[day]?.dinner;
    [lunch, dinner].forEach(id => seen.set(id, (seen.get(id) || 0) + 1));
    if (dinner && dinner === previousDinner) penalty += 3;
    previousDinner = dinner;
  });
  seen.forEach(count => {
    if (count > 2) penalty += (count - 2) * 1.2;
  });
  return penalty;
}

function calculateOmega3Bonus(plan) {
  let bonus = 0;
  daysOfWeek.forEach(day => {
    ["lunch", "dinner"].forEach(meal => {
      const rec = getRecipe(plan[day]?.[meal]);
      if (!rec) return;
      if ((rec.tags || []).includes("omega3")) bonus += 0.45;
      if ((rec.tags || []).includes("batch-cooking")) bonus += 0.15;
      bonus += Math.min(0.35, (rec.omegaScore || 0) / 40);
    });
  });
  return bonus;
}

function buildWeeklyPlanByRatio(targetRatio = 2, options = {}) {
  const lunches = recipes.filter(r => r.mealType === "lunch");
  const dinners = recipes.filter(r => r.mealType === "dinner");
  if (!lunches.length || !dinners.length) return;

  let best = null;
  const effectiveTarget = Math.max(0.2, targetRatio * 0.90); // slightly omega-3 forward

  for (let i = 0; i < 1100; i++) {
    const plan = {};
    daysOfWeek.forEach(day => {
      plan[day] = {
        lunch: pickRandom(lunches).id,
        dinner: pickRandom(dinners).id
      };
    });

    const ratio = calculatePlanRatio(plan);
    const ratioDistance = Math.abs(ratio - effectiveTarget);
    const score = ratioDistance * 12 + calculateVarietyPenalty(plan) - calculateOmega3Bonus(plan);
    if (!best || score < best.score) best = { plan, score, ratio };
  }

  weeklyPlan = best.plan;
  savePlan();
  renderCalendar();
  updateRatio();
  updateLogs();

  const status = $("#ratio-status");
  if (status) {
    status.textContent = `Plan rebuilt for target ${targetRatio.toFixed(1)}:1. Current plan: ${ratioToString(best.ratio)}.`;
  }
}

function initPlan() {
  const saved = safeJsonParse(localStorage.getItem(STORE.plan), null);
  if (saved && daysOfWeek.every(day => saved[day])) {
    weeklyPlan = saved;
    return;
  }
  buildWeeklyPlanByRatio(getTargetRatio());
}

function calendarMealCard(recipe, day, meal) {
  return `
    <article class="flip-card calendar-card" data-recipe-id="${escapeHtml(recipe.id)}" tabindex="0" role="button" aria-label="Flip ${escapeHtml(recipe.name)} for ${day} ${meal}">
      <div class="flip-inner">
        <div class="flip-front calendar-front">
          <div class="calendar-card-content">
            <label class="calendar-check"><input type="checkbox" data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}"> Complete</label>
            <h3>${escapeHtml(recipe.name)}</h3>
            <div class="recipe-meta compact">
              <span class="badge ${meal === "lunch" ? "green" : "fall"}">${meal === "lunch" ? "Packed lunch" : "Dinner"}</span>
              <span class="badge">${ratioToString(recipe.ratio)}</span>
            </div>
            <p class="source-note">Tap card for ingredients, steps, prep time, and servings.</p>
          </div>
        </div>
        <div class="flip-back calendar-back">
          <h3>${escapeHtml(recipe.name)}</h3>
          <p class="source-note">Prep: ${prepTimeLabel(recipe)} · Serves ${recipe.servings || 4} · ratio ${ratioToString(recipe.ratio)}</p>
          <h4>Ingredients</h4>
          <ul>${recipeIngredientsHtml(recipe, 8)}</ul>
          <h4>Steps</h4>
          <ol>${recipeStepsHtml(recipe, 5)}</ol>
          <button class="ghost close-card-btn" type="button">Flip back</button>
        </div>
      </div>
    </article>
  `;
}

function renderCalendar() {
  const tbody = $("#calendar-table tbody");
  tbody.innerHTML = "";
  daysOfWeek.forEach(day => {
    const lunchRec = getRecipe(weeklyPlan[day]?.lunch) || recipes.find(r => r.mealType === "lunch") || recipes[0];
    const dinnerRec = getRecipe(weeklyPlan[day]?.dinner) || recipes.find(r => r.mealType === "dinner") || recipes[0];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="day-cell">${escapeHtml(day)}</td>
      <td>${calendarMealCard(lunchRec, day, "lunch")}</td>
      <td>${calendarMealCard(dinnerRec, day, "dinner")}</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateRatio() {
  $("#current-ratio-display").textContent = ratioToString(calculatePlanRatio(weeklyPlan));
}

function handleCheckboxChange(e) {
  const day = e.target.dataset.day;
  const meal = e.target.dataset.meal;
  const recId = weeklyPlan[day][meal];
  completionLog.push({ day, meal, recId, completed: e.target.checked, timestamp: new Date().toISOString() });
  saveLog();
  updateLogs();
}

function topList(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `<li>${escapeHtml(k)} (${v})</li>`).join("") || "<li>No data yet</li>";
}

function updateLogs() {
  const dailyCompletion = {};
  daysOfWeek.forEach(day => dailyCompletion[day] = 0);

  const checkboxMap = {};
  $$("#calendar-table input[type=checkbox]").forEach(box => {
    checkboxMap[box.dataset.day + "-" + box.dataset.meal] = box.checked;
  });

  const completedRecipeCounts = {};
  const declinedRecipeCounts = {};
  const completedIngredientCounts = {};
  const declinedIngredientCounts = {};

  daysOfWeek.forEach(day => {
    ["lunch", "dinner"].forEach(meal => {
      const rec = getRecipe(weeklyPlan[day]?.[meal]);
      if (!rec) return;
      const checked = checkboxMap[day + "-" + meal] || false;
      const recipeCounter = checked ? completedRecipeCounts : declinedRecipeCounts;
      const ingredientCounter = checked ? completedIngredientCounts : declinedIngredientCounts;
      recipeCounter[rec.name] = (recipeCounter[rec.name] || 0) + 1;
      (rec.ingredients || []).forEach(i => ingredientCounter[i.name] = (ingredientCounter[i.name] || 0) + 1);
      if (checked) dailyCompletion[day] += 1;
    });
  });

  const ratioData = daysOfWeek.map(day => {
    const l = getRecipe(weeklyPlan[day]?.lunch);
    const d = getRecipe(weeklyPlan[day]?.dinner);
    return ((l?.ratio || 0) + (d?.ratio || 0)) / 2;
  });

  if (completionChart) completionChart.destroy();
  if (ratioChart) ratioChart.destroy();

  completionChart = new Chart($("#completionChart"), {
    type: "line",
    data: {
      labels: daysOfWeek,
      datasets: [{ label: "Completed meals", data: daysOfWeek.map(d => dailyCompletion[d]), borderColor: "#00a76a", backgroundColor: "rgba(0,167,106,0.18)", tension: 0.3 }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true, suggestedMax: 2, ticks: { stepSize: 1 } } } }
  });

  ratioChart = new Chart($("#ratioChart"), {
    type: "line",
    data: {
      labels: daysOfWeek,
      datasets: [{ label: "omega‑6:omega‑3 ratio", data: ratioData, borderColor: "#e07a5f", backgroundColor: "rgba(224,122,95,0.18)", tension: 0.3 }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true, suggestedMax: 2 } } }
  });

  $("#top-completed-list").innerHTML = topList(completedRecipeCounts);
  $("#top-declined-list").innerHTML = topList(declinedRecipeCounts);
  $("#top-completed-ingredients").innerHTML = topList(completedIngredientCounts);
  $("#top-declined-ingredients").innerHTML = topList(declinedIngredientCounts);
}

function normalizeRecipe(rawRecipe, fallbackMealType = "dinner", source = "Spoonacular") {
  const name = rawRecipe.title || rawRecipe.name || "Imported Recipe";
  const id = (name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "recipe") + "-" + Date.now();
  const ingredientNames = (rawRecipe.extendedIngredients || rawRecipe.ingredients || [])
    .map(item => typeof item === "string" ? item : (item.original || item.name || "ingredient"))
    .filter(Boolean);

  const steps = [];
  if (Array.isArray(rawRecipe.analyzedInstructions) && rawRecipe.analyzedInstructions.length) {
    rawRecipe.analyzedInstructions.forEach(group => (group.steps || []).forEach(step => steps.push(step.step)));
  }
  if (!steps.length && typeof rawRecipe.instructions === "string") {
    steps.push(...rawRecipe.instructions.replace(/<[^>]+>/g, "").split(/\.\s+/).filter(Boolean).map(s => s.trim().replace(/\.$/, "") + "."));
  }
  if (!steps.length) steps.push("Open the source recipe for full instructions.");

  const ingredients = ingredientNames.map(name => ({ name, category: classifyIngredient(name) }));
  const nutrientRatio = extractOmegaRatioFromNutrition(rawRecipe);
  const estimatedRatio = estimateOmegaRatioFromIngredients(ingredientNames, fallbackMealType);
  const ratio = nutrientRatio ?? estimatedRatio;
  const tags = [fallbackMealType, source.toLowerCase().replace(/\s+/g, "-")];
  if (ratio < 0.75) tags.push("omega3");
  if (rawRecipe.readyInMinutes && rawRecipe.readyInMinutes <= 35) tags.push("quick");

  return {
    id,
    name,
    mealType: fallbackMealType,
    servings: rawRecipe.servings || 4,
    source,
    image: rawRecipe.image || "assets/img/recipe-placeholder.svg",
    ratio,
    omegaScore: omegaScoreFromRatio(ratio),
    prepTimeMinutes: rawRecipe.readyInMinutes || null,
    tags,
    ingredients,
    steps: steps.slice(0, 8),
    url: rawRecipe.sourceUrl || rawRecipe.url || ""
  };
}

function importRecipe(recipe) {
  recipes.push(recipe);
  saveCustomRecipes();
  renderRecipeCards();
  buildWeeklyPlanByRatio(getTargetRatio());
}

async function searchSpoonacularIngredients() {
  const q = $("#ingredient-api-query").value.trim();
  const output = $("#ingredient-api-results");
  const recipeOutput = $("#related-recipe-results");
  output.innerHTML = "";
  recipeOutput.innerHTML = "";
  if (!q) return;
  try {
    const url = `https://api.spoonacular.com/food/ingredients/search?query=${encodeURIComponent(q)}&number=8&apiKey=${SPOONACULAR_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Spoonacular ingredient search failed.");
    const data = await res.json();
    output.innerHTML = (data.results || []).map(item => `
      <div class="result-card">
        <strong>${escapeHtml(item.name)}</strong><br>
        <span class="muted">Ingredient ID: ${escapeHtml(item.id)}</span>
        <div class="btn-row">
          <button data-find-recipes="${escapeHtml(item.name)}">Find recipes with this</button>
        </div>
      </div>
    `).join("") || "<p>No ingredient results found.</p>";
  } catch (err) {
    output.innerHTML = `<div class="notice error">${escapeHtml(err.message)}</div>`;
  }
}

async function findRecipesByIngredient(ingredient) {
  const output = $("#related-recipe-results");
  output.innerHTML = `<div class="notice">Finding recipes with ${escapeHtml(ingredient)}...</div>`;
  try {
    const url = `https://api.spoonacular.com/recipes/findByIngredients?ingredients=${encodeURIComponent(ingredient)}&number=8&ranking=1&ignorePantry=true&apiKey=${SPOONACULAR_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Related recipe search failed.");
    const data = await res.json();
    output.innerHTML = (data || []).map(recipe => `
      <div class="result-card">
        <img src="${escapeHtml(recipe.image || "assets/img/recipe-placeholder.svg")}" alt="" style="width:100%;height:140px;object-fit:cover;border-radius:12px;">
        <h3>${escapeHtml(recipe.title)}</h3>
        <p class="muted">Used: ${escapeHtml((recipe.usedIngredients || []).map(i => i.name).join(", ") || "n/a")}</p>
        <p class="muted">Missing: ${escapeHtml((recipe.missedIngredients || []).map(i => i.name).slice(0, 4).join(", ") || "n/a")}</p>
        <button data-import-spoonacular="${escapeHtml(recipe.id)}">Preview & import</button>
      </div>
    `).join("") || "<p>No related recipes found.</p>";
  } catch (err) {
    output.innerHTML = `<div class="notice error">${escapeHtml(err.message)}</div>`;
  }
}

async function importSpoonacularRecipe(recipeId) {
  const output = $("#api-status");
  output.innerHTML = `<div class="notice">Importing Spoonacular recipe...</div>`;
  try {
    const url = `https://api.spoonacular.com/recipes/${recipeId}/information?includeNutrition=true&apiKey=${SPOONACULAR_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Recipe detail request failed.");
    const data = await res.json();
    const recipe = normalizeRecipe(data, "dinner", "Spoonacular API");
    importRecipe(recipe);
    output.innerHTML = `<div class="notice">Imported <strong>${escapeHtml(recipe.name)}</strong> into Recipe Library. Estimated ratio: ${ratioToString(recipe.ratio)}.</div>`;
    setActiveTab("recipes");
  } catch (err) {
    output.innerHTML = `<div class="notice error">${escapeHtml(err.message)}</div>`;
  }
}

async function searchNutrition() {
  const query = $("#nutrition-query").value.trim();
  const output = $("#nutrition-results");
  output.innerHTML = "";
  if (!query) return;
  try {
    const searchUrl = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=1&api_key=${USDA_API_KEY}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) throw new Error("USDA search request failed.");
    const searchData = await searchRes.json();
    const food = searchData.foods?.[0];
    if (!food) {
      output.innerHTML = "<p>No USDA result found.</p>";
      return;
    }

    const detailUrl = `https://api.nal.usda.gov/fdc/v1/food/${food.fdcId}?api_key=${USDA_API_KEY}`;
    const detailRes = await fetch(detailUrl);
    if (!detailRes.ok) throw new Error("USDA detail request failed.");
    const detail = await detailRes.json();
    const targets = { 1008: "Energy (kcal)", 1003: "Protein (g)", 1004: "Total fat (g)", 1005: "Carbohydrate (g)" };
    const found = {};
    (detail.foodNutrients || []).forEach(n => {
      const key = targets[n.nutrient?.number] || targets[n.nutrientId];
      if (key) found[key] = n.amount ?? n.value;
    });

    output.innerHTML = `
      <div class="result-card">
        <h3>${escapeHtml(food.description)}</h3>
        <p class="muted">FDC ID: ${escapeHtml(food.fdcId)}</p>
        <ul>${Object.entries(found).map(([name, value]) => `<li>${escapeHtml(name)}: ${escapeHtml(value ?? "n/a")}</li>`).join("")}</ul>
      </div>
    `;
  } catch (err) {
    output.innerHTML = `<div class="notice error">${escapeHtml(err.message)}</div>`;
  }
}

async function importRecipeFromUrl() {
  const url = $("#recipe-url").value.trim();
  const status = $("#api-status");
  if (!url) return;
  try {
    status.innerHTML = `<div class="notice">Trying recipe‑scrapers import...</div>`;
    const mod = await import("https://cdn.jsdelivr.net/npm/recipe-scrapers-js@1.0.0/dist/index.mjs");
    let scraped;
    if (typeof mod.scrape === "function") scraped = await mod.scrape(url);
    else if (typeof mod.default === "function") scraped = await mod.default(url);
    else throw new Error("recipe‑scrapers-js loaded, but no browser scrape function was found.");

    const recipe = normalizeRecipe(scraped, "dinner", "recipe‑scrapers import");
    recipe.url = url;
    importRecipe(recipe);
    status.innerHTML = `<div class="notice">Imported: ${escapeHtml(recipe.name)}. Estimated ratio: ${ratioToString(recipe.ratio)}.</div>`;
  } catch (err) {
    status.innerHTML = `<div class="notice error">Import failed. Most recipe sites block browser scraping. Use a backend proxy for production. ${escapeHtml(err.message)}</div>`;
  }
}

function addManualRecipe() {
  const name = $("#recipe-name").value.trim();
  const mealType = $("#meal-type").value;
  const servings = parseInt($("#recipe-servings").value, 10) || 4;
  const ratioInput = parseFloat($("#recipe-ratio").value);
  const image = $("#recipe-image").value.trim() || "assets/img/recipe-placeholder.svg";
  const tags = $("#recipe-tags").value.split(",").map(s => s.trim()).filter(Boolean);
  const ingredientLines = $("#recipe-ingredients").value.split("\n").map(s => s.trim()).filter(Boolean);
  const stepLines = $("#recipe-instructions").value.split("\n").map(s => s.trim()).filter(Boolean);

  if (!name || !ingredientLines.length || !stepLines.length) {
    alert("Please add a recipe name, ingredients, and steps.");
    return;
  }

  const ratio = Number.isFinite(ratioInput) ? ratioInput : estimateOmegaRatioFromIngredients(ingredientLines, mealType);

  importRecipe({
    id: name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now(),
    name,
    mealType,
    servings,
    source: "Manual entry",
    image,
    ratio,
    omegaScore: omegaScoreFromRatio(ratio),
    prepTimeMinutes: null,
    tags,
    ingredients: ingredientLines.map(name => ({ name, category: classifyIngredient(name) })),
    steps: stepLines
  });

  $("#add-recipe-form").style.display = "none";
}

function useDinnerLeftovers() {
  daysOfWeek.slice(1).forEach((day, i) => {
    const previousDay = daysOfWeek[i];
    weeklyPlan[day].lunch = weeklyPlan[previousDay].dinner;
  });
  savePlan();
  renderCalendar();
  updateRatio();
  updateLogs();
}

function handleRatioSlider(value, immediate = false) {
  const ratio = parseFloat(value);
  localStorage.setItem(STORE.targetRatio, String(ratio));
  $("#ratio-target-display").textContent = `${ratio.toFixed(1)}:1`;
  clearTimeout(ratioRebuildTimer);
  ratioRebuildTimer = setTimeout(() => buildWeeklyPlanByRatio(ratio), immediate ? 0 : 160);
}

function attachEvents() {
  $$(".tab-btn").forEach(btn => btn.addEventListener("click", () => setActiveTab(btn.dataset.tab)));

  document.addEventListener("click", event => {
    const card = event.target.closest(".flip-card");
    if (card && !event.target.closest("button, a, select, input, textarea, label")) {
      card.classList.toggle("flipped");
    }

    const close = event.target.closest(".close-card-btn");
    if (close) close.closest(".flip-card")?.classList.remove("flipped");

    const view = event.target.closest(".view-details-btn");
    if (view) view.closest(".flip-card")?.classList.add("flipped");

    const addWeek = event.target.closest(".add-to-week-btn");
    if (addWeek) {
      const recipe = getRecipe(addWeek.dataset.recipeId);
      if (!recipe) return;
      const day = daysOfWeek[0];
      weeklyPlan[day][recipe.mealType] = recipe.id;
      savePlan();
      renderCalendar();
      updateRatio();
      updateLogs();
      setActiveTab("calendar");
    }

    const findBtn = event.target.closest("[data-find-recipes]");
    if (findBtn) findRecipesByIngredient(findBtn.dataset.findRecipes);

    const importBtn = event.target.closest("[data-import-spoonacular]");
    if (importBtn) importSpoonacularRecipe(importBtn.dataset.importSpoonacular);
  });

  $("#recipe-search").addEventListener("input", renderRecipeCards);
  $("#recipe-type-filter").addEventListener("change", renderRecipeCards);
  $("#recipe-sort").addEventListener("change", renderRecipeCards);

  $("#add-recipe-btn").addEventListener("click", () => {
    const form = $("#add-recipe-form");
    form.style.display = form.style.display === "none" ? "block" : "none";
  });

  $("#save-recipe-btn").addEventListener("click", addManualRecipe);
  $("#reset-library-btn").addEventListener("click", () => {
    if (!confirm("Remove locally imported/manual recipes and reset the planner?")) return;
    localStorage.removeItem(STORE.recipes);
    localStorage.removeItem(STORE.plan);
    location.reload();
  });

  $("#ingredient-api-btn").addEventListener("click", searchSpoonacularIngredients);
  $("#nutrition-search-btn").addEventListener("click", searchNutrition);
  $("#import-btn").addEventListener("click", importRecipeFromUrl);

  $("#lucky-btn").addEventListener("click", () => buildWeeklyPlanByRatio(getTargetRatio()));
  $("#use-leftovers-btn").addEventListener("click", useDinnerLeftovers);

  $("#ratio-slider").addEventListener("input", e => handleRatioSlider(e.target.value));
  $("#ratio-slider").addEventListener("change", e => handleRatioSlider(e.target.value, true));

  $("#calendar-table").addEventListener("change", e => {
    if (e.target.matches("input[type=checkbox]")) handleCheckboxChange(e);
  });
}

async function init() {
  const response = await fetch("data/recipes.json");
  const starterRecipes = await response.json();
  const customRecipes = safeJsonParse(localStorage.getItem(STORE.recipes), []);
  completionLog = safeJsonParse(localStorage.getItem(STORE.log), []);

  recipes = [...starterRecipes, ...customRecipes].map(recipe => {
    const ingredientNames = (recipe.ingredients || []).map(i => i.name || i);
    const ratio = Number.isFinite(Number(recipe.ratio)) ? Number(recipe.ratio) : estimateOmegaRatioFromIngredients(ingredientNames, recipe.mealType);
    return {
      ...recipe,
      ratio,
      omegaScore: recipe.omegaScore || omegaScoreFromRatio(ratio),
      prepTimeMinutes: recipe.prepTimeMinutes || recipe.readyInMinutes || null,
      ingredients: (recipe.ingredients || []).map(i => typeof i === "string" ? { name: i, category: classifyIngredient(i) } : i),
      steps: recipe.steps || ["Open source recipe for instructions."]
    };
  });

  const target = getTargetRatio();
  $("#ratio-slider").value = target;
  $("#ratio-target-display").textContent = `${target.toFixed(1)}:1`;

  attachEvents();
  initPlan();
  renderRecipeCards();
  renderCalendar();
  updateRatio();
  updateLogs();
}

init().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML("afterbegin", `<div class="notice error">App failed to load: ${escapeHtml(err.message)}. If opening locally, run a simple local server because browsers may block loading data/recipes.json from file://.</div>`);
});
