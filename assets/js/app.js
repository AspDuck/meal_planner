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

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function safeJsonParse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
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
  const omega3Keywords = ["salmon", "mackerel", "sardine", "herring", "anchovy", "fish", "tuna", "flax", "chia", "purslane", "walnut", "mussel", "oyster", "clam", "trout", "cod"];
  const omega6Keywords = ["corn oil", "soybean oil", "sunflower oil", "safflower oil", "cottonseed oil", "grapeseed oil", "seed oil"];
  if (omega3Keywords.some(k => lower.includes(k))) return "omega3";
  if (omega6Keywords.some(k => lower.includes(k))) return "omega6";
  return "neutral";
}

function ratioToString(r) {
  if (!r || !Number.isFinite(r)) return "1:∞";
  if (r < 1) return `1:${(1 / r).toFixed(1)}`;
  return `${r.toFixed(1)}:1`;
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
    <article class="flip-card" data-recipe-id="${recipe.id}" tabindex="0" role="button" aria-label="Flip ${recipe.name}">
      <div class="flip-inner">
        <div class="flip-front">
          <img class="recipe-img" src="${recipe.image || "assets/img/recipe-placeholder.svg"}" alt="">
          <div class="flip-front-content">
            <h3>${recipe.name}</h3>
            <div class="recipe-meta">
              <span class="badge ${recipe.mealType === "lunch" ? "green" : "fall"}">${recipe.mealType === "lunch" ? "Packed lunch" : "Weeknight meal"}</span>
              <span class="badge gold">${recipe.servings || 4} servings</span>
              <span class="badge">ratio ${ratioToString(recipe.ratio)}</span>
            </div>
            <p class="source-note">Source: ${recipe.source || "Unknown"}</p>
            <p class="muted">${(recipe.tags || []).slice(0, 4).join(" · ") || "Click to view ingredients and steps."}</p>
            <button class="ghost view-details-btn" type="button">View ingredients & steps</button>
          </div>
        </div>
        <div class="flip-back">
          <h3>${recipe.name}</h3>
          <h4>Ingredients</h4>
          <ul>${(recipe.ingredients || []).map(i => `<li>${i.name} <span class="source-note">(${i.category || "neutral"})</span></li>`).join("")}</ul>
          <h4>Steps</h4>
          <ol>${(recipe.steps || []).map(s => `<li>${s}</li>`).join("")}</ol>
          <div class="btn-row">
            <button class="add-to-week-btn" data-recipe-id="${recipe.id}" type="button">Add to this week</button>
            <button class="ghost close-card-btn" type="button">Flip back</button>
          </div>
          ${recipe.url ? `<p><a href="${recipe.url}" target="_blank" rel="noopener">Open source recipe</a></p>` : ""}
        </div>
      </div>
    </article>
  `).join("");
}

function initPlan() {
  const saved = safeJsonParse(localStorage.getItem(STORE.plan), null);
  if (saved && daysOfWeek.every(day => saved[day])) {
    weeklyPlan = saved;
    return;
  }
  buildWeeklyPlanByRatio(getTargetRatio());
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

function buildWeeklyPlanByRatio(targetRatio = 2) {
  const lunches = recipes.filter(r => r.mealType === "lunch");
  const dinners = recipes.filter(r => r.mealType === "dinner");
  if (!lunches.length || !dinners.length) return;

  let best = null;
  const effectiveTarget = targetRatio * 0.85; // slightly omega-3 forward

  for (let i = 0; i < 700; i++) {
    const plan = {};
    daysOfWeek.forEach(day => {
      plan[day] = {
        lunch: pickRandom(lunches).id,
        dinner: pickRandom(dinners).id
      };
    });

    const ratio = calculatePlanRatio(plan);
    const score = Math.abs(ratio - effectiveTarget) * 10 + calculateVarietyPenalty(plan) - calculateOmega3Bonus(plan);
    if (!best || score < best.score) best = { plan, score };
  }

  weeklyPlan = best.plan;
  savePlan();
  renderCalendar();
  updateRatio();
  updateLogs();
}

function renderCalendar() {
  const tbody = $("#calendar-table tbody");
  tbody.innerHTML = "";
  daysOfWeek.forEach(day => {
    const lunchRec = getRecipe(weeklyPlan[day]?.lunch) || recipes.find(r => r.mealType === "lunch") || recipes[0];
    const dinnerRec = getRecipe(weeklyPlan[day]?.dinner) || recipes.find(r => r.mealType === "dinner") || recipes[0];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${day}</td>
      <td>
        <span class="meal-name">${lunchRec.name}</span>
        <label><input type="checkbox" data-day="${day}" data-meal="lunch"> Completed</label><br>
        <span class="ratio-display">Ratio: ${ratioToString(lunchRec.ratio)}</span>
      </td>
      <td>
        <span class="meal-name">${dinnerRec.name}</span>
        <label><input type="checkbox" data-day="${day}" data-meal="dinner"> Completed</label><br>
        <span class="ratio-display">Ratio: ${ratioToString(dinnerRec.ratio)}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateRatio() {
  $("#current-ratio-display").textContent = ratioToString(calculatePlanRatio(weeklyPlan));
}

function getTargetRatio() {
  return parseFloat(localStorage.getItem(STORE.targetRatio) || $("#ratio-slider")?.value || "2");
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
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `<li>${k} (${v})</li>`).join("") || "<li>No data yet</li>";
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
      datasets: [{ label: "Omega‑6:Omega‑3 ratio", data: ratioData, borderColor: "#e07a5f", backgroundColor: "rgba(224,122,95,0.18)", tension: 0.3 }]
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
  const omega3 = ingredients.filter(i => i.category === "omega3").length;
  const omega6 = ingredients.filter(i => i.category === "omega6").length;
  const ratio = omega3 ? omega6 / omega3 : 1;

  return {
    id,
    name,
    mealType: fallbackMealType,
    servings: rawRecipe.servings || 4,
    source,
    image: rawRecipe.image || "assets/img/recipe-placeholder.svg",
    ratio,
    omegaScore: Math.max(1, Math.min(10, Math.round((1 / (ratio + 0.1)) * 2))),
    tags: [fallbackMealType, source.toLowerCase().replace(/\s+/g, "-")],
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
        <strong>${item.name}</strong><br>
        <span class="muted">Ingredient ID: ${item.id}</span>
        <div class="btn-row">
          <button data-find-recipes="${item.name}">Find recipes with this</button>
        </div>
      </div>
    `).join("") || "<p>No ingredient results found.</p>";
  } catch (err) {
    output.innerHTML = `<div class="notice error">${err.message}</div>`;
  }
}

async function findRecipesByIngredient(ingredient) {
  const output = $("#related-recipe-results");
  output.innerHTML = `<div class="notice">Finding recipes with ${ingredient}...</div>`;
  try {
    const url = `https://api.spoonacular.com/recipes/findByIngredients?ingredients=${encodeURIComponent(ingredient)}&number=8&ranking=1&ignorePantry=true&apiKey=${SPOONACULAR_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Related recipe search failed.");
    const data = await res.json();
    output.innerHTML = (data || []).map(recipe => `
      <div class="result-card">
        <img src="${recipe.image || "assets/img/recipe-placeholder.svg"}" alt="" style="width:100%;height:140px;object-fit:cover;border-radius:12px;">
        <h3>${recipe.title}</h3>
        <p class="muted">Used: ${(recipe.usedIngredients || []).map(i => i.name).join(", ") || "n/a"}</p>
        <p class="muted">Missing: ${(recipe.missedIngredients || []).map(i => i.name).slice(0, 4).join(", ") || "n/a"}</p>
        <button data-import-spoonacular="${recipe.id}">Preview & import</button>
      </div>
    `).join("") || "<p>No related recipes found.</p>";
  } catch (err) {
    output.innerHTML = `<div class="notice error">${err.message}</div>`;
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
    output.innerHTML = `<div class="notice">Imported <strong>${recipe.name}</strong> into Recipe Library.</div>`;
    setActiveTab("recipes");
  } catch (err) {
    output.innerHTML = `<div class="notice error">${err.message}</div>`;
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
        <h3>${food.description}</h3>
        <p class="muted">FDC ID: ${food.fdcId}</p>
        <ul>${Object.entries(found).map(([name, value]) => `<li>${name}: ${value ?? "n/a"}</li>`).join("")}</ul>
      </div>
    `;
  } catch (err) {
    output.innerHTML = `<div class="notice error">${err.message}</div>`;
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
    status.innerHTML = `<div class="notice">Imported: ${recipe.name}</div>`;
  } catch (err) {
    status.innerHTML = `<div class="notice error">Import failed. Most recipe sites block browser scraping. Use a backend proxy for production. ${err.message}</div>`;
  }
}

function addManualRecipe() {
  const name = $("#recipe-name").value.trim();
  const mealType = $("#meal-type").value;
  const servings = parseInt($("#recipe-servings").value, 10) || 4;
  const ratio = parseFloat($("#recipe-ratio").value) || 1;
  const image = $("#recipe-image").value.trim() || "assets/img/recipe-placeholder.svg";
  const tags = $("#recipe-tags").value.split(",").map(s => s.trim()).filter(Boolean);
  const ingredientLines = $("#recipe-ingredients").value.split("\n").map(s => s.trim()).filter(Boolean);
  const stepLines = $("#recipe-instructions").value.split("\n").map(s => s.trim()).filter(Boolean);

  if (!name || !ingredientLines.length || !stepLines.length) {
    alert("Please add a recipe name, ingredients, and steps.");
    return;
  }

  importRecipe({
    id: name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now(),
    name,
    mealType,
    servings,
    source: "Manual entry",
    image,
    ratio,
    omegaScore: Math.max(1, Math.min(10, Math.round((1 / (ratio + 0.1)) * 2))),
    tags,
    ingredients: ingredientLines.map(name => ({ name, category: classifyIngredient(name) })),
    steps: stepLines
  });

  $("#add-recipe-form").style.display = "none";
}

function useDinnerLeftovers() {
  const lunchLikeDinners = daysOfWeek.slice(1).forEach((day, i) => {
    const previousDay = daysOfWeek[i];
    weeklyPlan[day].lunch = weeklyPlan[previousDay].dinner;
  });
  savePlan();
  renderCalendar();
  updateRatio();
  updateLogs();
}

function attachEvents() {
  $$(".tab-btn").forEach(btn => btn.addEventListener("click", () => setActiveTab(btn.dataset.tab)));

  document.addEventListener("click", event => {
    const card = event.target.closest(".flip-card");
    if (card && !event.target.closest("button, a, select, input, textarea")) {
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

  $("#ratio-slider").addEventListener("input", e => {
    const value = parseFloat(e.target.value);
    localStorage.setItem(STORE.targetRatio, String(value));
    $("#ratio-target-display").textContent = `${value.toFixed(1)}:1`;
    buildWeeklyPlanByRatio(value);
  });

  $("#calendar-table").addEventListener("change", e => {
    if (e.target.matches("input[type=checkbox]")) handleCheckboxChange(e);
  });
}

async function init() {
  const response = await fetch("data/recipes.json");
  const starterRecipes = await response.json();
  const customRecipes = safeJsonParse(localStorage.getItem(STORE.recipes), []);
  completionLog = safeJsonParse(localStorage.getItem(STORE.log), []);

  recipes = [...starterRecipes, ...customRecipes];

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
  document.body.insertAdjacentHTML("afterbegin", `<div class="notice error">App failed to load: ${err.message}. If opening locally, run a simple local server because browsers may block loading data/recipes.json from file://.</div>`);
});
