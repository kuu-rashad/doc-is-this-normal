const AVATARS = ["blue", "brown", "green", "lime", "orange", "pink", "purple", "red", "yellow"];
const MAX_TREATMENT_LENGTH = 150;

let playerId = localStorage.getItem("playerId");
if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem("playerId", playerId);
}

let player = null;

const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  try {
    const response = await fetch(`/api/players/${playerId}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body && JSON.stringify(body),
    });
    // 403 means this player no longer exists (an admin deleted all players): start over at the
    // join screen. The returned promise never settles, so the caller's screen change is skipped.
    if (response.status === 403) {
      player = null;
      showJoinForm();
      return new Promise(() => {});
    }
    return { ok: response.ok, status: response.status, data: await response.json() };
  } catch {
    return { ok: false, status: 0, data: { error: "Couldn't reach the game. Check your connection and try again." } };
  }
}

function show(screenId) {
  $("loading").hidden = true;
  for (const screen of document.querySelectorAll(".screen")) screen.hidden = screen.id !== screenId;
  for (const error of document.querySelectorAll(".error")) error.hidden = true;
  window.scrollTo(0, 0);
}

function showError(form, message) {
  const error = form.querySelector(".error");
  error.textContent = message;
  error.hidden = false;
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

for (const back of document.querySelectorAll("[data-back]")) back.addEventListener("click", () => showMenu());

// ---------- Join / edit profile ----------

const joinForm = $("join-form");
const nicknameInput = $("nickname");
const joinButton = $("join-button");

function updateJoinButton() {
  joinButton.disabled = !nicknameInput.value.trim() || !joinForm.avatar.value;
}

function showJoinForm() {
  // Fresh random avatar order every time the form is shown.
  $("avatars").innerHTML = shuffle(AVATARS).map((name) => `
    <input type="radio" name="avatar" id="avatar-${name}" value="${name}">
    <label for="avatar-${name}"><img src="/avatars/${name}.png" alt="${name} avatar"></label>
  `).join("");
  nicknameInput.value = player?.nickname ?? "";
  joinForm.avatar.value = player?.avatar ?? "";
  joinButton.textContent = player ? "Save" : "Join game";
  updateJoinButton();
  show("join-form");
}

joinForm.addEventListener("input", updateJoinButton);

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  joinButton.disabled = true;
  const isNewPlayer = !player;
  const { ok, data } = await api("PUT", "", { nickname: nicknameInput.value, avatar: joinForm.avatar.value });
  if (!ok) {
    showError(joinForm, data.error);
    updateJoinButton();
    return;
  }
  player = data;
  // New players go straight to writing their first symptom.
  if (isNewPlayer) startSymptom();
  else showMenu();
});

// ---------- Menu ----------

function showMenu(notice) {
  $("me-avatar").src = `/avatars/${player.avatar}.png`;
  $("me-name").textContent = `Dr. ${player.nickname}`;
  $("menu-notice").textContent = notice ?? "";
  $("menu-notice").hidden = !notice;
  show("menu");
}

$("menu-symptom").addEventListener("click", () => startSymptom());
$("menu-treat").addEventListener("click", () => startTreatment());
$("menu-vote").addEventListener("click", () => startVote());
$("menu-edit").addEventListener("click", () => showJoinForm());

// ---------- Symptom ----------

const symptomForm = $("symptom-form");
let template = null;

async function startSymptom() {
  const { ok, data } = await api("GET", "/symptom-template");
  if (!ok) return showMenu(data.error);
  template = data;

  // Turn "Whenever I {{a}}, I…" into text with a tappable blank per slot.
  const preview = $("symptom-preview");
  preview.replaceChildren();
  template.text.split(/\{\{(\w+)\}\}/).forEach((part, i) => {
    if (i % 2 === 0) return preview.append(part);
    const blank = document.createElement("span");
    blank.className = "blank";
    blank.dataset.slot = part;
    blank.textContent = " ";
    blank.addEventListener("click", () => $(`slot-${part}`).scrollIntoView({ behavior: "smooth", block: "center" }));
    preview.append(blank);
  });

  $("symptom-slots").innerHTML = Object.entries(template.slots).map(([key, slot]) => `
    <fieldset class="slot" id="slot-${key}">
      <legend>${slot.hint.replace(/,?\s*e\.g\..*$/, "")}</legend>
      <div class="chips">
        ${slot.options.map((option, i) => `
          <input type="radio" name="${key}" id="slot-${key}-${i}" value="${i}">
          <label for="slot-${key}-${i}"></label>
        `).join("")}
      </div>
    </fieldset>
  `).join("");
  // Options go in via textContent so quotes and apostrophes in the config can't break the markup.
  for (const [key, slot] of Object.entries(template.slots)) {
    slot.options.forEach((option, i) => (symptomForm.querySelector(`label[for="slot-${key}-${i}"]`).textContent = option));
  }

  updateSymptom();
  show("symptom-form");
}

function chosenSlots() {
  const chosen = {};
  for (const [key, slot] of Object.entries(template.slots)) {
    const index = symptomForm.elements[key].value;
    if (index !== "") chosen[key] = slot.options[index];
  }
  return chosen;
}

function updateSymptom() {
  const chosen = chosenSlots();
  for (const blank of symptomForm.querySelectorAll(".blank")) {
    const value = chosen[blank.dataset.slot];
    blank.textContent = value ?? " ";
    blank.classList.toggle("filled", Boolean(value));
  }
  $("symptom-submit").disabled = Object.keys(chosen).length < Object.keys(template.slots).length;
}

symptomForm.addEventListener("change", updateSymptom);

symptomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  $("symptom-submit").disabled = true;
  const { ok, data } = await api("POST", "/symptoms", { templateId: template.id, slots: chosenSlots() });
  if (!ok) {
    showError(symptomForm, data.error);
    updateSymptom();
    return;
  }
  startTreatment();
});

// ---------- Treatment ----------

const treatmentForm = $("treatment-form");
const treatmentText = $("treatment-text");
let treatmentSymptom = null;

async function startTreatment() {
  const { ok, status, data } = await api("GET", "/treatment-task");
  if (status === 404) return showMenu("No patients are waiting right now. Try again in a moment!");
  if (!ok) return showMenu(data.error);
  treatmentSymptom = data;
  $("treatment-symptom").textContent = `“${data.text}”`;
  treatmentText.value = "";
  updateTreatment();
  show("treatment-form");
}

function updateTreatment() {
  $("treatment-counter").textContent = `${treatmentText.value.length}/${MAX_TREATMENT_LENGTH}`;
  $("treatment-submit").disabled = !treatmentText.value.trim();
}

treatmentText.addEventListener("input", updateTreatment);

treatmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  $("treatment-submit").disabled = true;
  const { ok, status, data } = await api("POST", "/treatments", { symptomId: treatmentSymptom.id, text: treatmentText.value });
  if (status === 409) return showMenu(data.error);
  if (!ok) {
    showError(treatmentForm, data.error);
    updateTreatment();
    return;
  }
  startVote();
});

// ---------- Voting ----------

const voteForm = $("vote-form");
let voteSymptom = null;
let points = {};

async function startVote() {
  const { ok, status, data } = await api("GET", "/vote-task");
  if (status === 404) return showMenu("Nothing new to vote on yet. Check back soon!");
  if (!ok) return showMenu(data.error);
  voteSymptom = data;
  points = Object.fromEntries(data.treatments.map((t) => [t.id, 0]));

  $("vote-symptom").textContent = `“${data.text}”`;
  const options = $("vote-options");
  options.replaceChildren();
  for (const treatment of data.treatments) {
    const card = document.createElement("div");
    card.className = "vote-option";
    const text = document.createElement("p");
    text.textContent = treatment.text;
    const thumbs = document.createElement("div");
    thumbs.className = "thumbs";
    for (const [value, label, name] of [[1, "👍", "Like"], [2, "👍👍", "Love"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", name);
      button.dataset.treatment = treatment.id;
      button.dataset.value = value;
      thumbs.append(button);
    }
    card.append(text, thumbs);
    options.append(card);
  }
  updateVotes();
  show("vote-form");
}

function updateVotes() {
  for (const button of voteForm.querySelectorAll(".thumbs button")) {
    button.setAttribute("aria-pressed", String(points[button.dataset.treatment] === Number(button.dataset.value)));
  }
  const total = Object.values(points).reduce((sum, value) => sum + value, 0);
  $("vote-submit").textContent = total ? "Send votes" : "Skip";
}

// Tapping the selected thumb again clears it.
$("vote-options").addEventListener("click", (event) => {
  const button = event.target.closest(".thumbs button");
  if (!button) return;
  const { treatment, value } = button.dataset;
  points[treatment] = points[treatment] === Number(value) ? 0 : Number(value);
  updateVotes();
});

voteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  $("vote-submit").disabled = true;
  const { ok, data } = await api("POST", "/votes", { symptomId: voteSymptom.id, points });
  $("vote-submit").disabled = false;
  if (!ok) return showError(voteForm, data.error);
  const total = Object.values(points).reduce((sum, value) => sum + value, 0);
  showMenu(total ? "Thanks for voting!" : null);
});

// ---------- Start ----------

api("GET", "").then(({ ok, data }) => {
  player = ok ? data : null;
  if (player) showMenu();
  else showJoinForm();
});
