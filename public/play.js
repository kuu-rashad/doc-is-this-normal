const AVATARS = [
  "blue", "brown", "green", "lime", "orange", "pink", "purple", "red", "yellow",
  "green_patient", "purple_patient", "yellow_patient",
];
const SLOT_LIMIT = 40;
const SYMPTOM_LIMIT = 160;
const PRESCRIPTION_LIMIT = 120;
const CHIPS_PER_SLOT = 3;
const POLL_MS = 10 * 1000;
const PHASE_NAMES = { clinic_open: "Clinic open", second_opinions: "Second opinions", finals: "Finals" };
// "shuffle" icon from Google Material Symbols (Apache 2.0)
const SHUFFLE_ICON = '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M606-160q-13 0-21.5-8.5T576-190q0-13 8.5-21.5T606-220h90L543-372q-9-9-9-21t9-21q9-9 21.5-9.5T586-415l154 153v-91q0-13 8.5-21.5T770-383q13 0 21.5 8.5T800-353v163q0 13-8.5 21.5T770-160H606Zm-436-10q-9-9-9-21t9-21l528-528h-92q-13 0-21.5-8.5T576-770q0-13 8.5-21.5T606-800h164q13 0 21.5 8.5T800-770v163q0 13-8.5 21.5T770-577q-13 0-21.5-8.5T740-607v-90L212-169q-9 9-21 8.5t-21-9.5Zm-1-579q-9-9-9-21.5t9-21.5q9-9 21-9t21 9l205 205q9 9 9.5 21t-8.5 21q-9 9-21.5 9t-21.5-9L169-749Z"/></svg>';

let playerId = localStorage.getItem("playerId");
if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem("playerId", playerId);
}

let player = null;
let state = null;
// Difference between the server's clock and this phone's, so the countdown is right.
let clockOffset = 0;

const $ = (id) => document.getElementById(id);

async function request(url, method = "GET", body) {
  try {
    const response = await fetch(url, {
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
    // 423 means the phase changed and this action is closed now: back to the home screen.
    if (response.status === 423) {
      const data = await response.json();
      showHome(data.error);
      return new Promise(() => {});
    }
    return { ok: response.ok, status: response.status, data: await response.json() };
  } catch {
    return { ok: false, status: 0, data: { error: "Couldn't reach the game. Check your connection and try again." } };
  }
}

const api = (method, path, body) => request(`/api/players/${playerId}${path}`, method, body);

function show(screenId) {
  // Lets the page style itself per screen (e.g. top-aligned where the keyboard comes up).
  document.body.dataset.screen = screenId;
  $("loading").hidden = true;
  for (const screen of document.querySelectorAll(".screen")) screen.hidden = screen.id !== screenId;
  for (const error of document.querySelectorAll(".error")) error.hidden = true;
  window.scrollTo(0, 0);
}

function currentScreen() {
  return document.querySelector(".screen:not([hidden])")?.id;
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

const pickRandom = (items) => items[Math.floor(Math.random() * items.length)];

for (const back of document.querySelectorAll("[data-back]")) back.addEventListener("click", () => showHome());

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
    <label for="avatar-${name}"><img src="/avatars/${name}.png" alt="${name.replace("_", " ")} avatar"></label>
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
  const { ok, data } = await api("PUT", "", { nickname: nicknameInput.value, avatar: joinForm.avatar.value });
  if (!ok) {
    showError(joinForm, data.error);
    updateJoinButton();
    return;
  }
  player = data;
  showHome();
});

// ---------- Home: phase, time left, and that phase's actions ----------

async function refreshState() {
  const { ok, data } = await request("/api/state");
  if (!ok) return;
  state = data;
  clockOffset = data.now - Date.now();
  renderHome();
}

function renderHome() {
  if (!player || !state) return;
  $("me-avatar").src = `/avatars/${player.avatar}.png`;
  $("me-name").textContent = player.nickname;
  $("phase-name").textContent = PHASE_NAMES[state.phase];
  // Each button lists the phases it's available in.
  for (const button of document.querySelectorAll("[data-phases]")) {
    button.hidden = !button.dataset.phases.split(" ").includes(state.phase);
  }
  renderTimer();
}

function renderTimer() {
  if (!state) return;
  const left = Math.max(0, state.phaseEndsAt - (Date.now() + clockOffset));
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  $("phase-timer").textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function showHome(notice) {
  $("home-notice").textContent = notice ?? "";
  $("home-notice").hidden = !notice;
  renderHome();
  show("home");
  await refreshState();
}

// While the home screen is open (and the phone is awake), check the phase every 10 seconds,
// and right away once the countdown runs out. Other screens are never interrupted.
setInterval(() => {
  if (currentScreen() !== "home" || document.hidden) return;
  renderTimer();
  if (state && Date.now() + clockOffset > state.phaseEndsAt + 1000) refreshState();
}, 1000);
setInterval(() => {
  if (currentScreen() === "home" && !document.hidden) refreshState();
}, POLL_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentScreen() === "home") refreshState();
});

$("home-symptom").addEventListener("click", () => startSymptom());
$("home-prescribe").addEventListener("click", () => startPrescription());
$("home-vote").addEventListener("click", () => startVote());
$("home-finals").addEventListener("click", () => startFinals());
$("home-edit").addEventListener("click", () => showJoinForm());

// ---------- Fill-in-the-blank (symptoms and prescriptions) ----------

// A template sentence with a text field per blank. The sentence fills in as the player types,
// and each blank offers a few suggestions from its pool, with a button to draw new ones.
function createFillIn({ preview, slots, idPrefix, limit, counter, onChange }) {
  let template = null;
  const input = (key) => $(`${idPrefix}-${key}`);

  function values() {
    return Object.fromEntries(Object.keys(template.slots).map((key) => [key, input(key).value.trim().replace(/\s+/g, " ")]));
  }

  function fullText() {
    const filled = values();
    return template.text.replace(/\{\{(\w+)\}\}/g, (_, key) => filled[key]);
  }

  function update() {
    if (!template) return;
    const filled = values();
    for (const blank of preview.querySelectorAll(".blank")) {
      const value = filled[blank.dataset.slot];
      blank.textContent = value || "\u00a0";
      blank.classList.toggle("filled", Boolean(value));
    }
    const length = fullText().length;
    counter.textContent = `${length}/${limit}`;
    onChange(Object.values(filled).every(Boolean) && length <= limit);
  }

  function renderChips(key) {
    const chips = slots.querySelector(`.chips[data-slot="${key}"]`);
    chips.replaceChildren();
    for (const option of shuffle(template.slots[key].options).slice(0, CHIPS_PER_SLOT)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = option;
      chip.addEventListener("click", () => {
        input(key).value = option;
        input(key).focus();
        update();
      });
      chips.append(chip);
    }
    const reshuffle = document.createElement("button");
    reshuffle.type = "button";
    reshuffle.className = "shuffle";
    reshuffle.setAttribute("aria-label", "Shuffle suggestions");
    reshuffle.innerHTML = SHUFFLE_ICON;
    reshuffle.addEventListener("click", () => renderChips(key));
    chips.append(reshuffle);
  }

  function setTemplate(next) {
    template = next;
    // Turn "Whenever I {{a}}, I…" into text with a blank per slot.
    preview.replaceChildren();
    template.text.split(/\{\{(\w+)\}\}/).forEach((part, i) => {
      if (i % 2 === 0) return preview.append(part);
      const blank = document.createElement("span");
      blank.className = "blank";
      blank.dataset.slot = part;
      preview.append(blank);
    });

    slots.replaceChildren();
    for (const [key, slot] of Object.entries(template.slots)) {
      const field = document.createElement("div");
      field.className = "slot";
      const label = document.createElement("label");
      label.htmlFor = `${idPrefix}-${key}`;
      label.textContent = slot.hint;
      const box = document.createElement("input");
      box.type = "text";
      box.id = `${idPrefix}-${key}`;
      box.maxLength = SLOT_LIMIT;
      box.autocomplete = "off";
      const chips = document.createElement("div");
      chips.className = "chips";
      chips.dataset.slot = key;
      field.append(label, box, chips);
      slots.append(field);
      renderChips(key);
    }
    update();
  }

  function surprise() {
    for (const [key, slot] of Object.entries(template.slots)) input(key).value = pickRandom(slot.options);
    update();
  }

  slots.addEventListener("input", update);
  return {
    setTemplate, values, update, surprise,
    get template() { return template; },
    focus: () => slots.querySelector("input")?.focus(),
  };
}

// ---------- Patient mode ----------

const symptomForm = $("symptom-form");
const symptomFill = createFillIn({
  preview: $("symptom-preview"),
  slots: $("symptom-slots"),
  idPrefix: "slot",
  limit: SYMPTOM_LIMIT,
  counter: $("symptom-counter"),
  onChange: (ready) => ($("symptom-submit").disabled = !ready),
});

async function startSymptom() {
  const { ok, data } = await api("GET", "/symptom-template");
  if (!ok) return showHome(data.error);
  symptomFill.setTemplate(data);
  show("symptom-form");
  symptomFill.focus();
}

$("surprise-me").addEventListener("click", () => symptomFill.surprise());

symptomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  $("symptom-submit").disabled = true;
  const { ok, data } = await api("POST", "/symptoms", { templateId: symptomFill.template.id, slots: symptomFill.values() });
  if (!ok) {
    showError(symptomForm, data.error);
    symptomFill.update();
    return;
  }
  startPrescription();
});

// ---------- Doctor mode ----------
// A prescription is either a filled-in frame ("Sounds like you need ___.") or the doctor's own words.

const prescriptionForm = $("prescription-form");
const prescriptionText = $("prescription-text");
let prescriptionSymptom = null;
let prescriptionFrames = [];
let frameIndex = 0;
let writingOwn = false;

const prescriptionFill = createFillIn({
  preview: $("rx-preview"),
  slots: $("rx-slots"),
  idPrefix: "rx-slot",
  limit: PRESCRIPTION_LIMIT,
  counter: $("prescription-counter"),
  onChange: (ready) => {
    if (!writingOwn) $("prescription-submit").disabled = !ready;
  },
});

async function startPrescription() {
  const { ok, status, data } = await api("GET", "/prescription-task");
  if (status === 404) return showHome("No patients are waiting right now. Try again in a moment!");
  if (!ok) return showHome(data.error);
  prescriptionSymptom = data;
  $("prescription-symptom").textContent = `“${data.text}”`;
  prescriptionFrames = shuffle(data.templates);
  frameIndex = 0;
  prescriptionText.value = "";
  setWritingOwn(false);
  show("prescription-form");
}

function setWritingOwn(own) {
  writingOwn = own;
  $("rx-fill").hidden = own;
  $("rx-own").hidden = !own;
  $("rx-other").hidden = own;
  $("rx-mode").textContent = own ? "Use a template" : "Write my own";
  if (own) {
    updateOwnPrescription();
    prescriptionText.focus();
  } else {
    prescriptionFill.setTemplate(prescriptionFrames[frameIndex]);
  }
}

function updateOwnPrescription() {
  $("prescription-counter").textContent = `${prescriptionText.value.length}/${PRESCRIPTION_LIMIT}`;
  $("prescription-submit").disabled = !prescriptionText.value.trim();
}

prescriptionText.addEventListener("input", updateOwnPrescription);

// Next frame, keeping whatever was typed in the blank if the new frame uses the same kind of blank.
$("rx-other").addEventListener("click", () => {
  const typed = Object.values(prescriptionFill.values())[0] ?? "";
  frameIndex = (frameIndex + 1) % prescriptionFrames.length;
  prescriptionFill.setTemplate(prescriptionFrames[frameIndex]);
  const [key, slot] = Object.entries(prescriptionFill.template.slots)[0];
  if (typed && slot.options.includes(typed)) {
    $(`rx-slot-${key}`).value = typed;
    prescriptionFill.update();
  }
});

$("rx-mode").addEventListener("click", () => setWritingOwn(!writingOwn));

prescriptionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  $("prescription-submit").disabled = true;
  const answer = writingOwn
    ? { text: prescriptionText.value }
    : { templateId: prescriptionFill.template.id, slots: prescriptionFill.values() };
  const { ok, data } = await api("POST", "/prescriptions", { round: prescriptionSymptom.round, symptomId: prescriptionSymptom.id, ...answer });
  if (!ok) {
    showError(prescriptionForm, data.error);
    if (writingOwn) updateOwnPrescription();
    else prescriptionFill.update();
    return;
  }
  // One shortlist vote after each prescription, then back home.
  startVote({ afterPrescription: true });
});

// ---------- Shortlist voting ----------

const voteForm = $("vote-form");
let matchup = null;
let thumbsUp = new Set();
let voteAfterPrescription = false;

async function startVote({ afterPrescription = false } = {}) {
  voteAfterPrescription = afterPrescription;
  const { ok, status, data } = await api("GET", "/vote-task");
  if (status === 404) return showHome(afterPrescription ? null : "Nothing new to vote on right now.");
  if (!ok) return showHome(data.error);
  matchup = data;
  thumbsUp = new Set();

  $("vote-symptom").textContent = `“${data.symptom}”`;
  const options = $("vote-options");
  options.replaceChildren();
  for (const prescription of data.prescriptions) {
    const card = document.createElement("div");
    card.className = "vote-option";
    const text = document.createElement("p");
    text.textContent = prescription.text;
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.textContent = "👍";
    thumb.setAttribute("aria-label", "Thumbs up");
    thumb.dataset.id = prescription.id;
    card.append(text, thumb);
    options.append(card);
  }
  updateVotes();
  show("vote-form");
}

function updateVotes() {
  for (const button of voteForm.querySelectorAll(".vote-option button")) {
    button.setAttribute("aria-pressed", String(thumbsUp.has(Number(button.dataset.id))));
  }
  $("vote-submit").textContent = thumbsUp.size ? "Send" : "Skip";
}

$("vote-options").addEventListener("click", (event) => {
  const button = event.target.closest(".vote-option button");
  if (!button) return;
  const id = Number(button.dataset.id);
  if (thumbsUp.has(id)) thumbsUp.delete(id);
  else thumbsUp.add(id);
  updateVotes();
});

voteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  $("vote-submit").disabled = true;
  const { ok, data } = await api("POST", "/votes", { round: matchup.round, ids: matchup.prescriptions.map((p) => p.id), up: [...thumbsUp] });
  $("vote-submit").disabled = false;
  if (!ok) return showError(voteForm, data.error);
  // One vote after each prescription; from the Vote button, keep going until there's nothing left.
  if (voteAfterPrescription) showHome();
  else startVote();
});

// ---------- Finals ----------

async function startFinals() {
  const { ok, data } = await api("GET", "/finals");
  if (!ok) return showHome(data.error);
  renderFinals(data);
  show("finals");
}

function renderFinals({ finalists, choice }) {
  const list = $("finalists");
  list.replaceChildren();
  finalists.forEach((finalist, i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "finalist";
    card.setAttribute("aria-pressed", String(choice === i));
    const symptom = document.createElement("p");
    symptom.className = "symptom";
    symptom.textContent = `“${finalist.symptom}”`;
    const prescription = document.createElement("p");
    prescription.className = "prescription";
    const avatar = document.createElement("img");
    avatar.src = `/avatars/${finalist.doctor.avatar}.png`;
    avatar.alt = "";
    const text = document.createElement("span");
    text.textContent = finalist.prescription;
    prescription.append(avatar, text);
    card.append(symptom, prescription);
    // Picking saves straight away; picking again changes the vote.
    card.addEventListener("click", async () => {
      const { ok, data } = await api("POST", "/finals", { choice: i });
      if (!ok) return showError($("finals"), data.error);
      renderFinals({ finalists, choice: data.choice });
    });
    list.append(card);
  });
}

// ---------- Start ----------

api("GET", "").then(({ ok, data }) => {
  player = ok ? data : null;
  if (player) showHome();
  else showJoinForm();
});
