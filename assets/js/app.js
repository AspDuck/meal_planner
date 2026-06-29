const state = {
  ingredients: [],
  recipes: [],
  selected: new Set(JSON.parse(localStorage.getItem("omegaNudge.selected") || "[]")),
  plan: JSON.parse(localStorage.getItem("omegaNudge.plan") || "{}"),
  shopping: JSON.parse(localStorage.getItem("omegaNudge.shopping") || "{}"),
  outcomes: JSON.parse(localStorage.getItem("omegaNudge.outcomes") || "[]"),
  history: JSON.parse(localStorage.getItem("omegaNudge.history") || "[]"),
  targetRatio: Number(localStorage.getItem("omegaNudge.targetRatio") || 4),
  shopView: localStorage.getItem("omegaNudge.shopView") || "store",
  location: JSON.parse(localStorage.getItem("omegaNudge.location") || "null")
};

const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const resetReasons = ["Skipped", "Family declined", "Ingredient unavailable", "Too expensive", "Not enough time", "Substituted", "Other"];
let ratioChart;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const save = () => {
  localStorage.setItem("omegaNudge.selected", JSON.stringify([...state.selected]));
  localStorage.setItem("omegaNudge.plan", JSON.stringify(state.plan));
  localStorage.setItem("omegaNudge.shopping", JSON.stringify(state.shopping));
  localStorage.setItem("omegaNudge.outcomes", JSON.stringify(state.outcomes));
  localStorage.setItem("omegaNudge.history", JSON.stringify(state.history));
  localStorage.setItem("omegaNudge.targetRatio", String(state.targetRatio));
  localStorage.setItem("omegaNudge.shopView", state.shopView);
  localStorage.setItem("omegaNudge.location", JSON.stringify(state.location));
};

function ratioLabel(value){
  if (!value || !Number.isFinite(value)) return "—";
  return `${Number(value).toFixed(value < 10 ? 1 : 0)}:1`;
}

function currentWeekKey(date = new Date()){
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}

function fridayReviewReady(){
  const d = new Date();
  const friday = new Date(d);
  friday.setDate(d.getDate() + (5 - d.getDay()));
  friday.setHours(21,0,0,0);
  return d >= friday || d.getDay() === 6;
}

function recipeById(id){ return state.recipes.find(r => r.id === id); }
function ingredientByName(name){
  const key = slug(name);
  return state.ingredients.find(i => i.id === key || slug(i.name) === key);
}

function ingredientAccess(name){
  const ing = ingredientByName(name);
  let base = ing?.accessibility ?? 0.7;
  const key = slug(name);
  const recent = Object.values(state.shopping).filter(s => s.ingredientId === key);
  const bad = recent.filter(s => ["not-found","too-expensive"].includes(s.status)).length;
  const good = recent.filter(s => ["bought","substituted"].includes(s.status)).length;
  return Math.max(0.05, Math.min(1, base + good * 0.03 - bad * 0.12));
}

function grocersFor(name){
  const ing = ingredientByName(name);
  return ing?.likelyGrocers?.slice(0,4) || ["Atlantic Superstore","Walmart","Sobeys"];
}

function recipeScore(recipe){
  const target = state.targetRatio;
  const avgAccess = recipe.ingredients.reduce((sum, item) => sum + ingredientAccess(item), 0) / recipe.ingredients.length;
  const accessScore = avgAccess * 35;

  let omegaScore = 0;
  const ratio = recipe.estimatedOmega6Omega3Ratio;
  if (ratio <= 1) omegaScore = 25;
  else if (ratio <= 2) omegaScore = 22;
  else if (ratio <= 4) omegaScore = 18;
  else omegaScore = 8;
  omegaScore += Math.min(10, recipe.estimatedOmega3g * 4);
  if (ratio <= target) omegaScore += 3;
  omegaScore = Math.min(35, omegaScore);

  const done = state.outcomes.filter(o => o.recipeId === recipe.id && o.status === "completed").length;
  const declined = state.outcomes.filter(o => o.recipeId === recipe.id && o.status === "family-declined").length;
  const skipped = state.outcomes.filter(o => o.recipeId === recipe.id && o.status === "skipped").length;
  const prefScore = Math.max(0, Math.min(20, 8 + done * 3 - declined * 5 - skipped * 1));

  const prepScore = recipe.prepMinutes <= 20 ? 10 : recipe.prepMinutes <= 40 ? 8 : 5;

  return Math.round(accessScore + omegaScore + prefScore + prepScore);
}

function topRecommendations(type){
  return state.recipes
    .filter(r => r.mealType === type)
    .map(r => ({...r, score: recipeScore(r)}))
    .sort((a,b) => b.score - a.score)
    .slice(0,10);
}

function selectedRecipes(){ return [...state.selected].map(recipeById).filter(Boolean); }

function selectedRatio(){
  const arr = selectedRecipes();
  if (!arr.length) return 0;
  return arr.reduce((s,r)=>s+r.estimatedOmega6Omega3Ratio,0) / arr.length;
}

function selectedOmega3(){
  const arr = selectedRecipes();
  return arr.reduce((s,r)=>s+r.estimatedOmega3g,0);
}

function setView(id){
  $$(".view").forEach(v => v.classList.toggle("active", v.id === id));
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === id));
}

function renderIngredients(){
  const filter = $("#ingredientFilter").value;
  const list = $("#ingredientList");
  let items = state.ingredients;
  if (filter === "omega-3" || filter === "omega-6") items = items.filter(i => i.category === filter);
  if (filter === "easy" || filter === "hard") items = items.filter(i => i.accessBand === filter);

  list.innerHTML = items.map((i, idx) => `
    <article class="card">
      <div class="card-head">
        <div>
          <h3>${idx + 1}. ${i.name}</h3>
          <p>${i.notes}</p>
        </div>
        <div class="score"><strong>${Math.round(i.score)}</strong><br><small>score</small></div>
      </div>
      <div class="badges">
        <span class="badge ${i.category === "omega-3" ? "green" : "amber"}">${i.category}</span>
        <span class="badge light">ratio ${ratioLabel(i.omega6Omega3Ratio)}</span>
        <span class="badge light">${i.omega3g}g omega-3</span>
        <span class="badge light">${Math.round(i.accessibility*100)}% access</span>
      </div>
      <div class="grocers">${i.likelyGrocers.map(g => `<span class="grocer-chip">${g}</span>`).join("")}</div>
      <div class="card-actions">
        <button class="pill-btn secondary ingredient-status" data-ingredient="${i.name}" data-status="found">Found</button>
        <button class="pill-btn warn ingredient-status" data-ingredient="${i.name}" data-status="not-found">Not found</button>
      </div>
    </article>
  `).join("");
}

function recipeCard(recipe){
  const selected = state.selected.has(recipe.id);
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h3>${recipe.name}</h3>
          <p>${recipe.tags.join(" · ")} · ${recipe.prepMinutes} min · 4 servings</p>
        </div>
        <div class="score"><strong>${recipe.score}</strong><br><small>/100</small></div>
      </div>
      <div class="badges">
        <span class="badge green">ratio ${ratioLabel(recipe.estimatedOmega6Omega3Ratio)}</span>
        <span class="badge light">${recipe.estimatedOmega3g}g omega-3</span>
        <span class="badge light">${Math.round(recipe.ingredients.reduce((s,i)=>s+ingredientAccess(i),0)/recipe.ingredients.length*100)}% access</span>
      </div>
      <p><strong>Why:</strong> improves omega balance with ${recipe.ingredients.slice(0,3).join(", ")}; likely at ${[...new Set(recipe.ingredients.flatMap(grocersFor))].slice(0,3).join(", ")}.</p>
      <details>
        <summary>Ingredients & steps</summary>
        <ul>${recipe.ingredients.map(i => `<li>${i}</li>`).join("")}</ul>
        <ol>${recipe.steps.map(s => `<li>${s}</li>`).join("")}</ol>
      </details>
      <div class="card-actions">
        <button class="pill-btn ${selected ? "selected" : ""} select-recipe" data-id="${recipe.id}">${selected ? "Selected" : "Select for week"}</button>
        <button class="pill-btn secondary decline-recipe" data-id="${recipe.id}">Family declined</button>
      </div>
    </article>
  `;
}

function renderRecommendations(){
  $("#targetRatioLabel").textContent = ratioLabel(state.targetRatio);
  $("#targetRatio").value = state.targetRatio;
  $("#lunchRecommendations").innerHTML = topRecommendations("lunch").map(recipeCard).join("");
  $("#dinnerRecommendations").innerHTML = topRecommendations("dinner").map(recipeCard).join("");
  updateHeader();
}

function buildPlan(){
  const dinners = selectedRecipes().filter(r => r.mealType === "dinner");
  const lunches = selectedRecipes().filter(r => r.mealType === "lunch");
  const fallbackDinners = topRecommendations("dinner");
  const fallbackLunches = topRecommendations("lunch");

  const plan = {};
  days.forEach((day, idx) => {
    const dinner = (dinners[idx % Math.max(1,dinners.length)] || fallbackDinners[idx % fallbackDinners.length]);
    let lunch = (lunches[idx % Math.max(1,lunches.length)] || fallbackLunches[idx % fallbackLunches.length]);

    // Sunday-Thursday dinner leftovers become next-day lunch.
    if (idx > 0 && idx <= 5 && plan[days[idx-1]]?.dinnerId) {
      const previousDinner = recipeById(plan[days[idx-1]].dinnerId);
      if (previousDinner) lunch = previousDinner;
    }

    plan[day] = { lunchId: lunch?.id, dinnerId: dinner?.id };
  });
  state.plan = plan;
  save();
  renderPlan();
  updateHeader();
}

function renderPlan(){
  const list = $("#planList");
  if (!Object.keys(state.plan).length) {
    list.innerHTML = `<div class="notice">Pick recipes, then tap “Build plan.”</div>`;
    return;
  }
  list.innerHTML = days.map(day => {
    const p = state.plan[day];
    return `<div class="meal-row">
      <div class="day-label">${day.slice(0,3)}</div>
      <div class="stack">
        ${mealPlanCard(day, "lunch", recipeById(p.lunchId))}
        ${mealPlanCard(day, "dinner", recipeById(p.dinnerId))}
      </div>
    </div>`;
  }).join("");
}

function mealPlanCard(day, slot, recipe){
  if (!recipe) return "";
  const status = latestOutcome(recipe.id, day, slot)?.status || "";
  return `<article class="meal-card">
    <details>
      <summary>
        <h3>${slot === "lunch" ? "Packed lunch" : "Dinner"}: ${recipe.name}</h3>
        <div class="badges"><span class="badge green">${ratioLabel(recipe.estimatedOmega6Omega3Ratio)}</span><span class="badge light">${recipe.estimatedOmega3g}g omega-3</span></div>
      </summary>
      <ul>${recipe.ingredients.map(i=>`<li>${i}</li>`).join("")}</ul>
      <ol>${recipe.steps.map(s=>`<li>${s}</li>`).join("")}</ol>
      <div class="status-bar">
        ${["completed","skipped","family-declined","ingredient-unavailable","too-expensive","not-enough-time","substituted"].map(s =>
          `<button class="status-btn ${status===s ? "active":""}" data-recipe="${recipe.id}" data-day="${day}" data-slot="${slot}" data-status="${s}">${labelStatus(s)}</button>`
        ).join("")}
      </div>
    </details>
  </article>`;
}

function labelStatus(s){
  return s.split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(" ");
}

function latestOutcome(recipeId, day, slot){
  return [...state.outcomes].reverse().find(o => o.recipeId === recipeId && o.day === day && o.slot === slot && o.week === currentWeekKey());
}

function renderShop(){
  const list = $("#shoppingList");
  const selected = selectedRecipes();
  if (!selected.length) {
    list.innerHTML = `<div class="notice">Select recipes first. Your shopping list will appear here.</div>`;
    return;
  }
  const items = {};
  selected.forEach(r => r.ingredients.forEach(name => {
    const id = slug(name);
    if (!items[id]) items[id] = { id, name, recipes: [], grocers: grocersFor(name), category: ingredientByName(name)?.category || "unknown" };
    items[id].recipes.push(r.name);
  }));
  const arr = Object.values(items);

  if (state.shopView === "recipe") {
    list.innerHTML = selected.map(r => `<article class="card"><h3>${r.name}</h3>${r.ingredients.map(name => shopItem(items[slug(name)])).join("")}</article>`).join("");
  } else {
    const storeGroups = {};
    arr.forEach(item => {
      const store = item.grocers[0] || "Other";
      if (!storeGroups[store]) storeGroups[store] = [];
      storeGroups[store].push(item);
    });
    list.innerHTML = Object.entries(storeGroups).map(([store, group]) => `<article class="card"><h3>${store}</h3>${group.map(shopItem).join("")}</article>`).join("");
  }
}

function shopItem(item){
  const st = state.shopping[item.id]?.status || "needed";
  return `<div class="shop-item">
    <div><strong>${item.name}</strong> <span class="badge light">${item.category}</span></div>
    <div class="grocers">${item.grocers.slice(0,4).map(g=>`<span class="grocer-chip">${g}</span>`).join("")}</div>
    <small>For: ${[...new Set(item.recipes)].slice(0,3).join(", ")}</small>
    <div class="status-bar">
      ${["bought","not-found","too-expensive","substituted","skipped"].map(s => `<button class="status-btn ${st===s?"active":""}" data-item="${item.id}" data-name="${item.name}" data-status="${s}">${labelStatus(s)}</button>`).join("")}
    </div>
  </div>`;
}

function renderLog(){
  const ratio = planRatio();
  $("#weekRatioMetric").textContent = ratioLabel(ratio);
  $("#omega3Metric").textContent = selectedOmega3().toFixed(1) + "g";
  const completed = state.outcomes.filter(o => o.week === currentWeekKey() && o.status === "completed").length;
  $("#completionMetric").textContent = completed;

  const blockers = {};
  Object.values(state.shopping).forEach(s => {
    if (["not-found","too-expensive"].includes(s.status)) blockers[`${s.name} (${s.status})`] = (blockers[`${s.name} (${s.status})`]||0)+1;
  });
  const declined = {};
  state.outcomes.forEach(o => {
    if (o.status === "family-declined") declined[recipeById(o.recipeId)?.name || "Recipe"] = (declined[recipeById(o.recipeId)?.name || "Recipe"]||0)+1;
  });

  $("#patterns").innerHTML = `
    <article class="card"><h3>Patterns this week</h3>
    <p><strong>Family declined</strong> has a strong future penalty. <strong>Skipped</strong> only has a mild penalty because life happened.</p>
    <p><strong>Substituted</strong> counts as partial success and nudges the app toward flexibility.</p>
    <h3>Blockers</h3><ul>${Object.entries(blockers).map(([k,v])=>`<li>${k}: ${v}</li>`).join("") || "<li>No blockers logged yet.</li>"}</ul>
    <h3>Declined recipes</h3><ul>${Object.entries(declined).map(([k,v])=>`<li>${k}: ${v}</li>`).join("") || "<li>No family declines logged yet.</li>"}</ul>
    </article>`;

  $("#weekHistory").innerHTML = state.history.length ? state.history.slice().reverse().map((h, idx) => `
    <article class="card">
      <h3>Archived week ${h.week}</h3>
      <p>Ratio: ${ratioLabel(h.ratio)} · Omega-3: ${h.omega3g.toFixed(1)}g · Completed: ${h.completed}</p>
      <button class="pill-btn secondary restore-week" data-index="${state.history.length-1-idx}">Reopen / edit week</button>
    </article>`).join("") : `<div class="notice">No archived weeks yet. After Friday 9pm, use Review & Reset.</div>`;

  drawChart();
  updateHeader();
}

function planRatio(){
  const ids = days.flatMap(d => [state.plan[d]?.lunchId, state.plan[d]?.dinnerId]).filter(Boolean);
  const recs = ids.map(recipeById).filter(Boolean);
  return recs.length ? recs.reduce((s,r)=>s+r.estimatedOmega6Omega3Ratio,0)/recs.length : selectedRatio();
}

function drawChart(){
  const ctx = $("#ratioChart");
  if (!ctx) return;
  if (ratioChart) ratioChart.destroy();
  const labels = [...state.history.map(h=>h.week), "Current"].slice(-8);
  const data = [...state.history.map(h=>h.ratio), planRatio()].slice(-8);
  ratioChart = new Chart(ctx, {
    type:"line",
    data:{ labels, datasets:[{label:"omega-6:omega-3", data, borderColor:"#0a192f", backgroundColor:"rgba(10,25,47,.12)", tension:.3}]},
    options:{ responsive:true, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}}}
  });
}

function updateHeader(){
  $("#currentRatio").textContent = ratioLabel(planRatio() || selectedRatio());
  $("#selectedCount").textContent = state.selected.size;
  $("#resetStatus").textContent = fridayReviewReady() ? "Review" : "Fri 9pm";
}

function archiveWeek(){
  const completed = state.outcomes.filter(o=>o.week===currentWeekKey() && o.status==="completed").length;
  state.history.push({ week: currentWeekKey(), archivedAt: new Date().toISOString(), ratio: planRatio(), omega3g: selectedOmega3(), selected: [...state.selected], plan: state.plan, shopping: state.shopping, outcomes: state.outcomes, completed });
  state.plan = {};
  state.shopping = {};
  state.outcomes = [];
  state.selected = new Set();
  save();
  renderAll();
  setView("recipes");
}

function renderAll(){
  renderIngredients();
  renderRecommendations();
  renderPlan();
  renderShop();
  renderLog();
  updateHeader();
}

async function load(){
  const [ingredients, recipes] = await Promise.all([
    fetch("data/ingredients.json").then(r=>r.json()),
    fetch("data/recipes.json").then(r=>r.json())
  ]);
  state.ingredients = ingredients;
  state.recipes = recipes;
  bind();
  renderAll();
}

function bind(){
  $$(".nav-btn").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
  $("#ingredientFilter").addEventListener("change", renderIngredients);
  $("#targetRatio").addEventListener("input", e => {
    state.targetRatio = Number(e.target.value);
    save();
    renderRecommendations();
  });
  $("#refreshRecipes").addEventListener("click", renderRecommendations);
  $("#buildPlan").addEventListener("click", buildPlan);
  $("#reviewReset").addEventListener("click", () => {
    if (!fridayReviewReady() && !confirm("It is not Friday 9pm yet. Archive and reset anyway?")) return;
    archiveWeek();
  });
  $("#locationBtn").addEventListener("click", () => {
    if (!navigator.geolocation) return alert("Geolocation is not supported in this browser.");
    navigator.geolocation.getCurrentPosition(pos => {
      state.location = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: new Date().toISOString() };
      save();
      $("#locationBtn").textContent = "GPS on";
    }, () => alert("Could not access location. You can still use the planner with default grocer assumptions."));
  });
  $$(".seg").forEach(btn => btn.addEventListener("click", () => {
    state.shopView = btn.dataset.shopView;
    $$(".seg").forEach(b=>b.classList.toggle("active", b.dataset.shopView===state.shopView));
    save(); renderShop();
  }));
  document.body.addEventListener("click", e => {
    const select = e.target.closest(".select-recipe");
    if (select) {
      const id = select.dataset.id;
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      save(); renderRecommendations(); renderShop(); updateHeader();
    }
    const decline = e.target.closest(".decline-recipe");
    if (decline) {
      state.outcomes.push({ recipeId: decline.dataset.id, status:"family-declined", week:currentWeekKey(), at:new Date().toISOString() });
      save(); renderRecommendations(); renderLog();
    }
    const ingStatus = e.target.closest(".ingredient-status");
    if (ingStatus) {
      const name = ingStatus.dataset.ingredient;
      state.shopping[slug(name)] = { ingredientId: slug(name), name, status: ingStatus.dataset.status, store: "unspecified", week: currentWeekKey(), at: new Date().toISOString() };
      save(); renderIngredients(); renderLog();
    }
    const status = e.target.closest(".status-btn[data-recipe]");
    if (status) {
      state.outcomes.push({ recipeId: status.dataset.recipe, day: status.dataset.day, slot: status.dataset.slot, status: status.dataset.status, week: currentWeekKey(), at:new Date().toISOString() });
      save(); renderPlan(); renderLog();
    }
    const item = e.target.closest(".status-btn[data-item]");
    if (item) {
      state.shopping[item.dataset.item] = { ingredientId:item.dataset.item, name:item.dataset.name, status:item.dataset.status, store: closestStoreForItem(item.dataset.name), week:currentWeekKey(), at:new Date().toISOString() };
      save(); renderShop(); renderLog();
    }
    const restore = e.target.closest(".restore-week");
    if (restore) {
      const h = state.history[Number(restore.dataset.index)];
      if (!h) return;
      state.selected = new Set(h.selected || []);
      state.plan = h.plan || {};
      state.shopping = h.shopping || {};
      state.outcomes = h.outcomes || [];
      save(); renderAll(); setView("plan");
    }
  });
}

function closestStoreForItem(name){
  return grocersFor(name)[0] || "unspecified";
}

load().catch(err => {
  document.body.insertAdjacentHTML("afterbegin", `<div class="notice">Could not load app data. Run with a local server, not file://. ${err.message}</div>`);
});
