const USDA_API_KEY = "6keAxhN4R8b5EA6nIGcKyZE7leHMdqCHBaKXwPVc";
const SPOONACULAR_API_KEY = "71002a06138446b69ad0a2228b0159d4";

const STORE = {
  recipes: "omegaMealPlanner.customRecipes",
  log: "omegaMealPlanner.completionLog",
  plan: "omegaMealPlanner.weeklyPlan",
  targetRatio: "omegaMealPlanner.targetRatio",
  selectedRecipes: "omegaMealPlanner.selectedRecipes",
  recommendations: "omegaMealPlanner.recommendations",
  shoppingStatus: "omegaMealPlanner.shoppingStatus",
  weeklyHistory: "omegaMealPlanner.weeklyHistory",
  lastResetKey: "omegaMealPlanner.lastFridayResetKey"
};

const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let recipes = [];
let grocerRules = { defaultGrocers: ["Atlantic Superstore", "Walmart", "Sobeys"], rules: [] };
let reasons = { recipeUndoneReasons: [], ingredientReasons: [] };
let completionLog = [];
let weeklyPlan = {};
let selectedRecipeIds = new Set();
let currentRecommendations = [];
let shoppingStatus = {};
let weeklyHistory = [];
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

function saveSelectedRecipes() {
  localStorage.setItem(STORE.selectedRecipes, JSON.stringify([...selectedRecipeIds]));
}

function saveRecommendations() {
  localStorage.setItem(STORE.recommendations, JSON.stringify(currentRecommendations.map(r => r.id)));
}

function saveShoppingStatus() {
  localStorage.setItem(STORE.shoppingStatus, JSON.stringify(shoppingStatus));
}

function saveWeeklyHistory() {
  localStorage.setItem(STORE.weeklyHistory, JSON.stringify(weeklyHistory));
}

function classifyIngredient(name) {
  const lower = String(name).toLowerCase();
  const omega3Keywords = ["salmon", "mackerel", "sardine", "herring", "anchovy", "fish", "tuna", "flax", "chia", "purslane", "walnut", "mussel", "oyster", "clam", "trout", "cod", "seafood"];
  const omega6Keywords = ["corn oil", "soybean oil", "sunflower oil", "safflower oil", "cottonseed oil", "grapeseed oil", "seed oil", "sesame oil"];
  if (omega3Keywords.some(k => lower.includes(k))) return "omega3";
  if (omega6Keywords.some(k => lower.includes(k))) return "omega6";
  return "neutral";
}

function ratioToString(r) {
  const ratio = Number(r);
  if (!ratio || !Number.isFinite(ratio)) return "1:∞";
  if (ratio < 1) return `1:${(1 / ratio).toFixed(1)}`;
  return `${ratio.toFixed(1)}:1`;
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

function getTargetRatio() {
  return parseFloat(localStorage.getItem(STORE.targetRatio) || $("#ratio-slider")?.value || "2");
}

function getIngredientKey(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getGrocersForIngredient(name) {
  const lower = String(name).toLowerCase();
  const matched = grocerRules.rules.find(rule => (rule.match || []).some(keyword => lower.includes(keyword)));
  const grocers = matched ? matched.grocers : grocerRules.defaultGrocers;
  return [...new Set(grocers)].slice(0, Math.max(2, Math.min(4, grocers.length)));
}

function getIngredientAccessibility(name) {
  const lower = String(name).toLowerCase();
  if (["purslane", "oyster", "herring", "anchovy", "seaweed", "pasture"].some(k => lower.includes(k))) return 0.45;
  if (["mussel", "clam", "trout", "mackerel"].some(k => lower.includes(k))) return 0.72;
  if (["salmon", "sardine", "tuna", "chia", "flax", "walnut", "oats", "rice", "potato", "spinach"].some(k => lower.includes(k))) return 0.93;
  return 0.80;
}

function recipeAccessibility(recipe) {
  const ingredients = recipe.ingredients || [];
  if (!ingredients.length) return 0.6;
  return ingredients.reduce((sum, item) => sum + getIngredientAccessibility(item.name), 0) / ingredients.length;
}

function recipePatternPenalty(recipe) {
  let penalty = 0;
  const recent = completionLog.slice(-80);
  const undone = recent.filter(ev => ev.recId === recipe.id && ev.status === "undone").length;
  const completed = recent.filter(ev => ev.recId === recipe.id && ev.status === "completed").length;
  penalty += undone * 4;
  penalty -= completed * 1.25;

  const ingredients = (recipe.ingredients || []).map(i => i.name);
  ingredients.forEach(name => {
    const key = getIngredientKey(name);
    const statusEvents = Object.values(shoppingStatus).filter(row => row.ingredientKey === key);
    const inaccessible = statusEvents.filter(row => ["not_on_shelf", "too_expensive", "poor_quality"].includes(row.status)).length;
    penalty += inaccessible * 0.65;
  });

  return penalty;
}

function recipePrepScore(recipe) {
  const prep = Number(recipe.prepMinutes || recipe.readyInMinutes || 35);
  if (prep <= 25) return 10;
  if (prep <= 40) return 8;
  if (prep <= 60) return 6;
  return 3;
}

function recipeOmegaImpactScore(recipe, targetRatio = 2) {
  const ratio = Number(recipe.ratio || 1);
  let score = 0;
  if (ratio <= 1) score = 30;
  else if (ratio <= 2) score = 25;
  else if (ratio <= 4) score = 18;
  else if (ratio <= 8) score = 8;
  else score = 2;

  const tags = recipe.tags || [];
  if (tags.includes("omega3")) score += 3;
  if (tags.includes("batch-cooking")) score += 1;
  if (ratio <= targetRatio * 0.85) score += 2;
  return Math.min(30, score);
}

function scoreRecipe(recipe, targetRatio = 2) {
  const accessibility = recipeAccessibility(recipe) * 35;
  const omegaImpact = recipeOmegaImpactScore(recipe, targetRatio);
  const familyPracticality = 8 + Math.min(7, completionLog.filter(ev => ev.recId === recipe.id && ev.status === "completed").length * 2);
  const prep = recipePrepScore(recipe);
  const behavior = Math.max(0, 10 - recipePatternPenalty(recipe));
  const total = Math.round(Math.max(0, Math.min(100, accessibility + omegaImpact + familyPracticality + prep + behavior - 8)));
  return {
    id: recipe.id,
    score: total,
    accessibility: Math.round(accessibility),
    omegaImpact,
    prep,
    behavior,
    ratio: recipe.ratio || 1
  };
}

function generateRecommendations() {
  const target = getTargetRatio();
  currentRecommendations = recipes
    .map(recipe => ({ recipe, score: scoreRecipe(recipe, target) }))
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, 20)
    .map(row => ({ ...row.recipe, recommendationScore: row.score }));

  saveRecommendations();
  renderRecommendations();
  updateSelectedSummary();
}

function getSelectedRecipes() {
  return [...selectedRecipeIds].map(id => getRecipe(id)).filter(Boolean);
}

function selectedAverageRatio() {
  const selected = getSelectedRecipes();
  if (!selected.length) return 0;
  return selected.reduce((sum, recipe) => sum + Number(recipe.ratio || 1), 0) / selected.length;
}

function updateSelectedSummary() {
  const count = selectedRecipeIds.size;
  if ($("#selected-count")) $("#selected-count").textContent = count;
  if ($("#selected-ratio")) $("#selected-ratio").textContent = count ? ratioToString(selectedAverageRatio()) : "—";
  if ($("#next-reset-label")) $("#next-reset-label").textContent = formatNextFridayReset();
}

function renderRecommendations() {
  const grid = $("#recommendation-grid");
  if (!grid) return;
  if (!currentRecommendations.length) generateRecommendations();

  grid.innerHTML = currentRecommendations.map(recipe => {
    const score = recipe.recommendationScore || scoreRecipe(recipe, getTargetRatio());
    const checked = selectedRecipeIds.has(recipe.id) ? "checked" : "";
    const selectedClass = selectedRecipeIds.has(recipe.id) ? "selected" : "";
    const grocers = summarizeGrocersForRecipe(recipe).slice(0, 3).join(" · ");
    return `
      <article class="recommendation-card ${selectedClass}" data-recipe-id="${recipe.id}">
        <h3>${recipe.name}</h3>
        <div class="rec-score">
          <span class="score-pill green">${score.score}/100</span>
          <span class="score-pill">ratio ${ratioToString(recipe.ratio)}</span>
          <span class="score-pill gold">${Math.round(recipeAccessibility(recipe) * 100)}% access</span>
        </div>
        <p class="muted">${recipe.mealType === "lunch" ? "Packed lunch" : "Weeknight meal"} · ${(recipe.tags || []).slice(0, 3).join(" · ") || "recommended"}</p>
        <p class="muted"><strong>Likely grocers:</strong> ${grocers}</p>
        <p class="muted"><strong>Why:</strong> omega impact ${score.omegaImpact}/30, prep ${score.prep}/10, learned fit ${score.behavior}/10.</p>
        <label class="select-line">
          <input type="checkbox" class="select-recipe-checkbox" data-recipe-id="${recipe.id}" ${checked}>
          Select for this week
        </label>
      </article>
    `;
  }).join("");
}

function summarizeGrocersForRecipe(recipe) {
  const grocerCount = {};
  (recipe.ingredients || []).forEach(item => {
    getGrocersForIngredient(item.name).forEach(store => {
      grocerCount[store] = (grocerCount[store] || 0) + 1;
    });
  });
  return Object.entries(grocerCount).sort((a, b) => b[1] - a[1]).map(([store]) => store);
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
            <div class="btn-row">
              <button class="ghost view-details-btn" type="button">View ingredients & steps</button>
              <button class="select-single-recipe-btn" data-recipe-id="${recipe.id}" type="button">${selectedRecipeIds.has(recipe.id) ? "Selected" : "Select"}</button>
            </div>
          </div>
        </div>
        <div class="flip-back">
          <h3>${recipe.name}</h3>
          <p class="muted">Prep: ${recipe.prepMinutes || recipe.readyInMinutes || "30–45"} min · Serves ${recipe.servings || 4}</p>
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
  buildWeeklyPlanByRatio(getTargetRatio(), false);
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

function buildWeeklyPlanByRatio(targetRatio = 2, shouldRender = true) {
  const source = getSelectedRecipes().length >= 3 ? getSelectedRecipes() : recipes;
  const lunches = source.filter(r => r.mealType === "lunch");
  const dinners = source.filter(r => r.mealType === "dinner");
  if (!lunches.length || !dinners.length) return;

  let best = null;
  const effectiveTarget = targetRatio * 0.85; // slightly omega-3 forward

  for (let i = 0; i < 900; i++) {
    const plan = {};
    daysOfWeek.forEach(day => {
      plan[day] = { lunch: pickRandom(lunches).id, dinner: pickRandom(dinners).id };
    });

    const ratio = calculatePlanRatio(plan);
    const score = Math.abs(ratio - effectiveTarget) * 10 + calculateVarietyPenalty(plan) - calculateOmega3Bonus(plan);
    if (!best || score < best.score) best = { plan, score };
  }

  weeklyPlan = best.plan;
  savePlan();
  if (shouldRender) {
    renderCalendar();
    updateRatio();
    updateLogs();
  }
}

function buildWeekFromSelected() {
  if (selectedRecipeIds.size < 2) {
    alert("Select at least two recipes first.");
    return;
  }
  buildWeeklyPlanByRatio(getTargetRatio(), true);
  setActiveTab("calendar");
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
      <td>${renderCalendarMealCard(day, "lunch", lunchRec)}</td>
      <td>${renderCalendarMealCard(day, "dinner", dinnerRec)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCalendarMealCard(day, meal, recipe) {
  const statusKey = `${day}-${meal}-${recipe.id}`;
  const latest = [...completionLog].reverse().find(ev => ev.statusKey === statusKey);
  const completed = latest?.status === "completed" ? "checked" : "";
  const currentReason = latest?.reason || "";
  const reasonOptions = reasons.recipeUndoneReasons.map(reason => `<option value="${reason}" ${reason === currentReason ? "selected" : ""}>${reason}</option>`).join("");
  return `
    <article class="flip-card calendar-meal-card" data-recipe-id="${recipe.id}">
      <div class="flip-inner calendar-meal-inner">
        <div class="flip-front">
          <h3>${recipe.name}</h3>
          <div class="recipe-meta">
            <span class="badge">${ratioToString(recipe.ratio)}</span>
            <span class="badge gold">${recipe.servings || 4} servings</span>
          </div>
          <div class="calendar-controls">
            <label><input type="checkbox" data-day="${day}" data-meal="${meal}" data-status-key="${statusKey}" ${completed}> Completed</label>
            <select class="recipe-reason" data-day="${day}" data-meal="${meal}" data-status-key="${statusKey}">
              <option value="">If undone, choose reason</option>
              ${reasonOptions}
            </select>
            <span class="small-muted">Tap card to flip for ingredients and steps.</span>
          </div>
        </div>
        <div class="flip-back">
          <h3>${recipe.name}</h3>
          <p class="muted">Prep: ${recipe.prepMinutes || recipe.readyInMinutes || "30–45"} min · Serves ${recipe.servings || 4}</p>
          <h4>Ingredients</h4>
          <ul>${(recipe.ingredients || []).map(i => `<li>${i.name}</li>`).join("")}</ul>
          <h4>Steps</h4>
          <ol>${(recipe.steps || []).slice(0, 6).map(s => `<li>${s}</li>`).join("")}</ol>
          <button class="ghost close-card-btn" type="button">Flip back</button>
        </div>
      </div>
    </article>
  `;
}

function updateRatio() {
  $("#current-ratio-display").textContent = ratioToString(calculatePlanRatio(weeklyPlan));
  const status = $("#ratio-status");
  if (status) status.textContent = `Current plan rebuilt around target ${getTargetRatio().toFixed(1)}:1. Actual plan estimate: ${ratioToString(calculatePlanRatio(weeklyPlan))}.`;
}

function handleRecipeStatusChange(day, meal, statusKey, status, reason = "") {
  const recId = weeklyPlan[day]?.[meal];
  completionLog.push({
    day,
    meal,
    recId,
    statusKey,
    status,
    reason,
    timestamp: new Date().toISOString(),
    weekKey: getCurrentWeekKey()
  });
  saveLog();
  updateLogs();
}

function aggregateShoppingList() {
  const selected = getSelectedRecipes();
  const map = new Map();

  selected.forEach(recipe => {
    (recipe.ingredients || []).forEach(item => {
      const key = getIngredientKey(item.name);
      if (!map.has(key)) {
        map.set(key, {
          ingredientKey: key,
          name: item.name,
          category: item.category || classifyIngredient(item.name),
          count: 0,
          recipes: new Set(),
          grocers: getGrocersForIngredient(item.name)
        });
      }
      const row = map.get(key);
      row.count += 1;
      row.recipes.add(recipe.name);
    });
  });

  return [...map.values()].map(row => ({ ...row, recipes: [...row.recipes] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderShoppingList() {
  const list = aggregateShoppingList();
  const container = $("#shopping-list");
  const summary = $("#shopping-summary");

  const stats = {
    total: list.length,
    bought: list.filter(i => shoppingStatus[i.ingredientKey]?.status === "bought").length,
    notOnShelf: list.filter(i => shoppingStatus[i.ingredientKey]?.status === "not_on_shelf").length
  };

  summary.innerHTML = `
    <div><strong>${stats.total}</strong><span> ingredients</span></div>
    <div><strong>${stats.bought}</strong><span> bought</span></div>
    <div><strong>${stats.notOnShelf}</strong><span> not on shelf</span></div>
  `;

  if (!list.length) {
    container.innerHTML = `<div class="notice">No selected recipes yet. Go to Recommendations, select recipes, then build the shopping list.</div>`;
    return;
  }

  const grouped = list.reduce((acc, item) => {
    const key = item.category || "neutral";
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});

  container.innerHTML = Object.entries(grouped).map(([category, items]) => `
    <section class="shopping-group">
      <h3>${category}</h3>
      ${items.map(item => renderShoppingItem(item)).join("")}
    </section>
  `).join("");
}

function renderShoppingItem(item) {
  const status = shoppingStatus[item.ingredientKey]?.status || "needed";
  const reason = shoppingStatus[item.ingredientKey]?.reason || "";
  const reasonOptions = reasons.ingredientReasons.map(r => `<option value="${r}" ${r === reason ? "selected" : ""}>${r}</option>`).join("");
  return `
    <div class="shopping-item" data-ingredient-key="${item.ingredientKey}">
      <div>
        <div class="shopping-item-name">${item.name}</div>
        <div class="small-muted">Used in ${item.count} selected recipe${item.count > 1 ? "s" : ""}: ${item.recipes.slice(0, 3).join(", ")}${item.recipes.length > 3 ? "..." : ""}</div>
      </div>
      <div class="grocer-list"><strong>Likely grocers:</strong><br>${item.grocers.slice(0, 4).join("<br>")}</div>
      <div>
        <select class="item-status" data-ingredient-key="${item.ingredientKey}" data-ingredient-name="${item.name}">
          <option value="needed" ${status === "needed" ? "selected" : ""}>Needed</option>
          <option value="bought" ${status === "bought" ? "selected" : ""}>Bought</option>
          <option value="not_on_shelf" ${status === "not_on_shelf" ? "selected" : ""}>Not on shelf</option>
          <option value="too_expensive" ${status === "too_expensive" ? "selected" : ""}>Too expensive</option>
          <option value="substituted" ${status === "substituted" ? "selected" : ""}>Substituted</option>
          <option value="skipped" ${status === "skipped" ? "selected" : ""}>Skipped</option>
        </select>
      </div>
      <div>
        <select class="item-reason" data-ingredient-key="${item.ingredientKey}" data-ingredient-name="${item.name}">
          <option value="">Reason / note</option>
          ${reasonOptions}
        </select>
      </div>
    </div>
  `;
}

function resetShoppingStatuses() {
  shoppingStatus = {};
  saveShoppingStatus();
  renderShoppingList();
  updateLogs();
}

function recordIngredientStatus(key, name, status, reason = "") {
  shoppingStatus[key] = {
    ingredientKey: key,
    name,
    status,
    reason,
    timestamp: new Date().toISOString(),
    weekKey: getCurrentWeekKey()
  };
  saveShoppingStatus();
  updateLogs();
}

function topList(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `<li>${k} (${v})</li>`).join("") || "<li>No data yet</li>";
}

function updateLogs() {
  const dailyCompletion = {};
  daysOfWeek.forEach(day => dailyCompletion[day] = 0);

  const completedRecipeCounts = {};
  const undoneRecipeCounts = {};
  const accessibleIngredientCounts = {};
  const inaccessibleIngredientCounts = {};

  daysOfWeek.forEach(day => {
    ["lunch", "dinner"].forEach(meal => {
      const rec = getRecipe(weeklyPlan[day]?.[meal]);
      if (!rec) return;
      const statusKeyPrefix = `${day}-${meal}-${rec.id}`;
      const latest = [...completionLog].reverse().find(ev => ev.statusKey === statusKeyPrefix);
      if (latest?.status === "completed") {
        dailyCompletion[day] += 1;
        completedRecipeCounts[rec.name] = (completedRecipeCounts[rec.name] || 0) + 1;
      } else if (latest?.status === "undone") {
        undoneRecipeCounts[`${rec.name} — ${latest.reason || "No reason"}`] = (undoneRecipeCounts[`${rec.name} — ${latest.reason || "No reason"}`] || 0) + 1;
      }
    });
  });

  Object.values(shoppingStatus).forEach(row => {
    if (row.status === "bought") accessibleIngredientCounts[row.name] = (accessibleIngredientCounts[row.name] || 0) + 1;
    if (["not_on_shelf", "too_expensive", "poor_quality", "skipped"].includes(row.status)) {
      inaccessibleIngredientCounts[`${row.name} — ${row.reason || row.status}`] = (inaccessibleIngredientCounts[`${row.name} — ${row.reason || row.status}`] || 0) + 1;
    }
  });

  const ratioData = daysOfWeek.map(day => {
    const l = getRecipe(weeklyPlan[day]?.lunch);
    const d = getRecipe(weeklyPlan[day]?.dinner);
    return ((l?.ratio || 0) + (d?.ratio || 0)) / 2;
  });

  if (completionChart) completionChart.destroy();
  if (ratioChart) ratioChart.destroy();

  if ($("#completionChart")) {
    completionChart = new Chart($("#completionChart"), {
      type: "line",
      data: {
        labels: daysOfWeek,
        datasets: [{ label: "Completed meals", data: daysOfWeek.map(d => dailyCompletion[d]), borderColor: "#00a76a", backgroundColor: "rgba(0,167,106,0.18)", tension: 0.3 }]
      },
      options: { responsive: true, scales: { y: { beginAtZero: true, suggestedMax: 2, ticks: { stepSize: 1 } } } }
    });
  }

  if ($("#ratioChart")) {
    ratioChart = new Chart($("#ratioChart"), {
      type: "line",
      data: {
        labels: daysOfWeek,
        datasets: [{ label: "Omega‑6:Omega‑3 ratio", data: ratioData, borderColor: "#e07a5f", backgroundColor: "rgba(224,122,95,0.18)", tension: 0.3 }]
      },
      options: { responsive: true, scales: { y: { beginAtZero: true, suggestedMax: 2 } } }
    });
  }

  $("#top-completed-list").innerHTML = topList(completedRecipeCounts);
  $("#top-declined-list").innerHTML = topList(undoneRecipeCounts);
  $("#top-completed-ingredients").innerHTML = topList(accessibleIngredientCounts);
  $("#top-declined-ingredients").innerHTML = topList(inaccessibleIngredientCounts);
  renderWeeklyHistory();
}

function renderWeeklyHistory() {
  const el = $("#weekly-history");
  if (!el) return;
  if (!weeklyHistory.length) {
    el.innerHTML = `<div class="notice">No archived weeks yet. The app archives the current week before the Friday 9pm reset.</div>`;
    return;
  }

  el.innerHTML = `
    <table class="week-history-table">
      <thead>
        <tr><th>Week</th><th>Target</th><th>Actual ratio</th><th>Chosen</th><th>Completed</th><th>Unavailable ingredients</th></tr>
      </thead>
      <tbody>
        ${weeklyHistory.slice(-10).reverse().map(row => `
          <tr>
            <td>${row.weekKey}</td>
            <td>${ratioToString(row.targetRatio)}</td>
            <td>${ratioToString(row.actualRatio)}</td>
            <td>${row.selectedCount}</td>
            <td>${row.completedCount}</td>
            <td>${row.unavailableCount}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function archiveCurrentWeek(reason = "Friday 9pm reset") {
  const selected = getSelectedRecipes();
  const completedCount = completionLog.filter(ev => ev.weekKey === getCurrentWeekKey() && ev.status === "completed").length;
  const unavailableCount = Object.values(shoppingStatus).filter(row => row.weekKey === getCurrentWeekKey() && ["not_on_shelf", "too_expensive", "poor_quality", "skipped"].includes(row.status)).length;
  weeklyHistory.push({
    weekKey: getCurrentWeekKey(),
    archivedAt: new Date().toISOString(),
    reason,
    targetRatio: getTargetRatio(),
    actualRatio: calculatePlanRatio(weeklyPlan),
    selectedRecipeIds: [...selectedRecipeIds],
    selectedCount: selected.length,
    plan: weeklyPlan,
    completedCount,
    unavailableCount,
    shoppingStatus: Object.values(shoppingStatus)
  });
  saveWeeklyHistory();
}

function getCurrentWeekKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function getFridayResetDate(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToFriday = 5 - day;
  d.setDate(d.getDate() + diffToFriday);
  d.setHours(21, 0, 0, 0);
  return d;
}

function getActiveResetKey(date = new Date()) {
  const reset = getFridayResetDate(date);
  if (date >= reset) return reset.toISOString().slice(0, 10);
  return "";
}

function formatNextFridayReset(date = new Date()) {
  let reset = getFridayResetDate(date);
  if (date >= reset) {
    reset = new Date(reset);
    reset.setDate(reset.getDate() + 7);
  }
  return reset.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function checkFridayReset() {
  const key = getActiveResetKey(new Date());
  if (!key) {
    updateSelectedSummary();
    return;
  }
  const last = localStorage.getItem(STORE.lastResetKey);
  if (last === key) {
    updateSelectedSummary();
    return;
  }

  archiveCurrentWeek("Friday 9pm reset");
  selectedRecipeIds = new Set();
  shoppingStatus = {};
  completionLog = [];
  localStorage.setItem(STORE.lastResetKey, key);
  saveSelectedRecipes();
  saveShoppingStatus();
  saveLog();

  generateRecommendations();
  buildWeeklyPlanByRatio(getTargetRatio(), true);
  renderShoppingList();
  updateSelectedSummary();
}

function estimateRatioFromNutrition(rawRecipe, ingredients) {
  const nutrients = rawRecipe.nutrition?.nutrients || [];
  const omega3 = nutrients.find(n => /Omega-?3/i.test(n.name || ""));
  const omega6 = nutrients.find(n => /Omega-?6/i.test(n.name || ""));
  if (omega3 && omega6 && Number(omega3.amount) > 0) return Number(omega6.amount) / Number(omega3.amount);

  const weights = { omega3: 0, omega6: 0 };
  ingredients.forEach(item => {
    const lower = item.name.toLowerCase();
    if (item.category === "omega3") weights.omega3 += lower.includes("salmon") || lower.includes("sardine") || lower.includes("mackerel") ? 3 : 1.5;
    if (item.category === "omega6") weights.omega6 += 2;
    if (["chicken", "beef", "pork", "cream", "cheese", "butter", "sesame", "pumpkin"].some(k => lower.includes(k))) weights.omega6 += 0.6;
  });
  return weights.omega3 > 0 ? Math.max(0.1, weights.omega6 / weights.omega3) : 1;
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
  const ratio = estimateRatioFromNutrition(rawRecipe, ingredients);

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
    prepMinutes: rawRecipe.readyInMinutes || rawRecipe.preparationMinutes || 35,
    url: rawRecipe.sourceUrl || rawRecipe.url || ""
  };
}

function importRecipe(recipe) {
  recipes.push(recipe);
  saveCustomRecipes();
  renderRecipeCards();
  generateRecommendations();
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
        <div class="btn-row"><button data-find-recipes="${item.name}">Find recipes with this</button></div>
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
  daysOfWeek.slice(1).forEach((day, i) => {
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
    if (card && !event.target.closest("button, a, select, input, textarea, label")) card.classList.toggle("flipped");

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
      selectedRecipeIds.add(recipe.id);
      saveSelectedRecipes();
      savePlan();
      renderCalendar();
      renderRecommendations();
      renderRecipeCards();
      renderShoppingList();
      updateSelectedSummary();
      updateRatio();
      updateLogs();
      setActiveTab("calendar");
    }

    const selectSingle = event.target.closest(".select-single-recipe-btn");
    if (selectSingle) {
      const id = selectSingle.dataset.recipeId;
      if (selectedRecipeIds.has(id)) selectedRecipeIds.delete(id);
      else selectedRecipeIds.add(id);
      saveSelectedRecipes();
      renderRecipeCards();
      renderRecommendations();
      renderShoppingList();
      updateSelectedSummary();
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
    localStorage.removeItem(STORE.selectedRecipes);
    location.reload();
  });

  $("#refresh-recommendations-btn").addEventListener("click", generateRecommendations);
  $("#select-top-btn").addEventListener("click", () => {
    currentRecommendations.slice(0, 7).forEach(recipe => selectedRecipeIds.add(recipe.id));
    saveSelectedRecipes();
    renderRecommendations();
    renderRecipeCards();
    renderShoppingList();
    updateSelectedSummary();
  });
  $("#clear-selected-btn").addEventListener("click", () => {
    selectedRecipeIds = new Set();
    saveSelectedRecipes();
    renderRecommendations();
    renderRecipeCards();
    renderShoppingList();
    updateSelectedSummary();
  });
  $("#build-shopping-btn").addEventListener("click", () => {
    renderShoppingList();
    setActiveTab("shopping");
  });
  $("#rebuild-shopping-btn").addEventListener("click", renderShoppingList);
  $("#mark-all-needed-btn").addEventListener("click", resetShoppingStatuses);

  $("#recommendation-grid").addEventListener("change", e => {
    if (!e.target.matches(".select-recipe-checkbox")) return;
    const id = e.target.dataset.recipeId;
    if (e.target.checked) selectedRecipeIds.add(id);
    else selectedRecipeIds.delete(id);
    saveSelectedRecipes();
    renderRecommendations();
    renderRecipeCards();
    renderShoppingList();
    updateSelectedSummary();
  });

  $("#shopping-list").addEventListener("change", e => {
    if (!e.target.matches(".item-status, .item-reason")) return;
    const key = e.target.dataset.ingredientKey;
    const name = e.target.dataset.ingredientName;
    const row = e.target.closest(".shopping-item");
    const status = row.querySelector(".item-status").value;
    const reason = row.querySelector(".item-reason").value;
    recordIngredientStatus(key, name, status, reason);
    renderShoppingList();
  });

  $("#ingredient-api-btn").addEventListener("click", searchSpoonacularIngredients);
  $("#nutrition-search-btn").addEventListener("click", searchNutrition);
  $("#import-btn").addEventListener("click", importRecipeFromUrl);

  $("#lucky-btn").addEventListener("click", () => buildWeeklyPlanByRatio(getTargetRatio()));
  $("#use-leftovers-btn").addEventListener("click", useDinnerLeftovers);
  $("#use-selected-week-btn").addEventListener("click", buildWeekFromSelected);

  $("#ratio-slider").addEventListener("input", e => {
    const value = parseFloat(e.target.value);
    localStorage.setItem(STORE.targetRatio, String(value));
    $("#ratio-target-display").textContent = `${value.toFixed(1)}:1`;
    generateRecommendations();
    buildWeeklyPlanByRatio(value);
  });

  $("#calendar-table").addEventListener("change", e => {
    if (e.target.matches("input[type=checkbox]")) {
      const status = e.target.checked ? "completed" : "undone";
      const row = e.target.closest(".calendar-meal-card");
      const reasonSelect = row.querySelector(".recipe-reason");
      handleRecipeStatusChange(e.target.dataset.day, e.target.dataset.meal, e.target.dataset.statusKey, status, reasonSelect?.value || "");
    }
    if (e.target.matches(".recipe-reason")) {
      const reason = e.target.value;
      if (!reason) return;
      handleRecipeStatusChange(e.target.dataset.day, e.target.dataset.meal, e.target.dataset.statusKey, "undone", reason);
    }
  });

  setInterval(checkFridayReset, 60 * 1000);
}

async function init() {
  const [starterRecipes, grocerData, reasonData] = await Promise.all([
    fetch("data/recipes.json").then(r => r.json()),
    fetch("data/grocers.json").then(r => r.json()).catch(() => grocerRules),
    fetch("data/reasons.json").then(r => r.json()).catch(() => reasons)
  ]);

  const customRecipes = safeJsonParse(localStorage.getItem(STORE.recipes), []);
  completionLog = safeJsonParse(localStorage.getItem(STORE.log), []);
  selectedRecipeIds = new Set(safeJsonParse(localStorage.getItem(STORE.selectedRecipes), []));
  shoppingStatus = safeJsonParse(localStorage.getItem(STORE.shoppingStatus), {});
  weeklyHistory = safeJsonParse(localStorage.getItem(STORE.weeklyHistory), []);
  grocerRules = grocerData;
  reasons = reasonData;

  recipes = [...starterRecipes, ...customRecipes];

  const target = getTargetRatio();
  $("#ratio-slider").value = target;
  $("#ratio-target-display").textContent = `${target.toFixed(1)}:1`;

  attachEvents();
  initPlan();
  generateRecommendations();
  renderRecipeCards();
  renderCalendar();
  renderShoppingList();
  updateSelectedSummary();
  updateRatio();
  updateLogs();
  checkFridayReset();
}

init().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML("afterbegin", `<div class="notice error">App failed to load: ${err.message}. If opening locally, run a simple local server because browsers may block loading data/recipes.json from file://.</div>`);
});
