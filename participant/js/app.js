(function () {
  "use strict";

  const STORAGE_KEY = "thesisInterviewForms.v2";
  let backend;
  let state = { forms: {} };
  let saveTimer;
  let saveQueue = Promise.resolve();
  let navigationPending = false;

  function formStorage() {
    return backend && backend.mode === "public" ? window.sessionStorage : window.localStorage;
  }

  function clearStoredState() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) { /* Best effort. */ }
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch (error) { /* Best effort. */ }
  }

  function readState() {
    try { return JSON.parse(formStorage().getItem(STORAGE_KEY)) || { forms: {} }; } catch (error) { return { forms: {} }; }
  }
  function writeState(next) {
    state = next;
    try { formStorage().setItem(STORAGE_KEY, JSON.stringify(next)); return true; } catch (error) { return false; }
  }
  function sessionForms(session) {
    return session && session.forms && Object.prototype.toString.call(session.forms) === "[object Object]" ? session.forms : {};
  }
  function adoptSessionState(session) {
    const identity = String((session && session.sessionIdentity) || "");
    if (session && session.completed) {
      state = { forms: {}, sessionIdentity: identity, completed: true, participantReference: session.participantReference || "" };
      clearStoredState();
      return;
    }
    if (!identity || state.sessionIdentity !== identity) {
      state = { forms: sessionForms(session), sessionIdentity: identity };
    } else {
      state.forms = sessionForms(session);
    }
    writeState(state);
  }
  function bindStateToBackendSession() {
    const identity = String((backend && backend.session && backend.session.sessionIdentity) || "");
    if (identity && state.sessionIdentity !== identity) {
      state.sessionIdentity = identity;
      delete state.submissionKey;
    }
  }
  function formToObject(form) {
    const values = {};
    Array.from(form.elements).forEach((field) => {
      if (!field.name || ["submit", "button"].includes(field.type)) return;
      if (field.type === "checkbox") {
        if (!Array.isArray(values[field.name])) values[field.name] = [];
        if (field.checked) values[field.name].push(field.value);
      } else if (field.type === "radio") {
        if (field.checked) values[field.name] = field.value;
      } else values[field.name] = field.value;
    });
    return values;
  }
  function restoreForm(form) {
    const saved = state.forms && state.forms[form.dataset.prototypeForm];
    if (!saved) return;
    Array.from(form.elements).forEach((field) => {
      if (!field.name || !(field.name in saved)) return;
      if (field.type === "checkbox") field.checked = Array.isArray(saved[field.name]) && saved[field.name].includes(field.value);
      else if (field.type === "radio") field.checked = saved[field.name] === field.value;
      else field.value = saved[field.name];
    });
  }
  function updateSavedIndicator(status) {
    const copy = {
      waiting: "Not saved yet / لم يتم الحفظ بعد",
      saving: "Saving… / جارٍ الحفظ…",
      saved: "Saved ✓ / تم الحفظ ✓",
      error: "Save failed — retry on next change / تعذر الحفظ — ستتم المحاولة عند التغيير التالي"
    };
    document.querySelectorAll("[data-saved-state]").forEach((indicator) => {
      indicator.textContent = copy[status] || copy.waiting;
      indicator.classList.toggle("save-error", status === "error");
    });
  }
  function snapshotForm(form) {
    bindStateToBackendSession();
    state.forms = state.forms || {};
    state.forms[form.dataset.prototypeForm] = formToObject(form);
    state.updatedAt = new Date().toISOString();
    writeState(state);
    return state.forms;
  }
  function saveForm(form) {
    const forms = snapshotForm(form);
    updateSavedIndicator("saving");
    saveQueue = saveQueue.catch(() => {}).then(() => backend.save(forms)).then((result) => {
      updateSavedIndicator("saved"); initializeAudioSection(); return result;
    }).catch((error) => { updateSavedIndicator("error"); throw error; });
    return saveQueue;
  }
  function scheduleSave(form, delay) {
    updateSavedIndicator("saving");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveForm(form).catch(() => {}), delay || 900);
  }
  function preserveQueryParameters() {
    const current = new URLSearchParams(window.location.search);
    document.querySelectorAll("a[data-preserve-query]").forEach((link) => {
      const target = new URL(link.getAttribute("href"), window.location.href);
      current.forEach((value, key) => target.searchParams.set(key, value));
      link.href = target.href;
    });
  }
  function navigateWithQuery(path) {
    const target = new URL(path, window.location.href);
    const current = new URLSearchParams(window.location.search);
    current.forEach((value, key) => target.searchParams.set(key, value));
    navigateTo(target.href);
  }
  function navigateTo(href) {
    if (backend && backend.mode === "public") window.InterviewBackend.preparePublicNavigation(backend.session, href);
    window.location.href = href;
  }
  function enforceStartRoute(session) {
    if (!window.InterviewBackend.shouldRedirectToWelcome(session, window.location.href)) return false;
    window.location.replace(window.InterviewBackend.welcomeUrl(window.location.href));
    return true;
  }
  function enforceCompletedRoute(session) {
    if (!window.InterviewBackend.shouldRedirectCompletedToInterview(session, window.location.href)) return false;
    window.location.replace(window.InterviewBackend.interviewUrl(window.location.href));
    return true;
  }
  function toggleOtherField(controller) {
    const target = controller.dataset.otherController && document.querySelector(controller.dataset.otherController);
    if (!target) return;
    const wrapper = target.closest(".other-input-wrap");
    if (wrapper) wrapper.classList.toggle("visible", controller.checked);
    target.disabled = !controller.checked;
    target.setAttribute("aria-hidden", controller.checked ? "false" : "true");
  }
  function initializeOtherFields(form) {
    const controllers = Array.from(form.querySelectorAll("[data-other-controller]"));
    controllers.forEach(toggleOtherField);
    form.addEventListener("change", () => controllers.forEach(toggleOtherField));
  }
  function initializeNoneOptions(form) {
    form.querySelectorAll("[data-none-option]").forEach((none) => none.addEventListener("change", () => {
      if (!none.checked) return;
      const group = none.closest("[data-required-group]");
      group.querySelectorAll("input[type=checkbox]").forEach((input) => { if (input !== none) input.checked = false; });
      group.querySelectorAll("[data-other-controller]").forEach(toggleOtherField);
    }));
    form.querySelectorAll("[data-required-group] input[type=checkbox]:not([data-none-option])").forEach((input) => input.addEventListener("change", () => {
      if (!input.checked) return;
      const none = input.closest("[data-required-group]").querySelector("[data-none-option]");
      if (none) none.checked = false;
    }));
  }
  function initializeParticipantMode(session) {
    const reference = session.participantReference || (backend.mode === "public" ? "Public interview / مقابلة عامة" : "Private interview / مقابلة خاصة");
    document.querySelectorAll("[data-participant-reference]").forEach((element) => { element.textContent = reference; });
    document.querySelectorAll("[data-public-only]").forEach((element) => { element.hidden = backend.mode !== "public"; });
    document.querySelectorAll("[data-reset-prototype]").forEach((element) => { element.hidden = backend.mode !== "public"; });
  }
  function initializeConsent(form) {
    const startButton = document.querySelector("[data-start-interview]");
    const stopNotice = document.querySelector("[data-consent-stop]");
    const update = () => {
      const selected = form.querySelector("input[name=participation_consent]:checked");
      if (startButton) startButton.disabled = !(selected && selected.value === "yes");
      if (stopNotice) stopNotice.hidden = !(selected && selected.value === "no");
    };
    form.addEventListener("change", update); update();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const selected = form.querySelector("input[name=participation_consent]:checked");
      if (!selected) return void window.PrototypeValidation.validateForm(form);
      if (selected.value !== "yes") { stopNotice.hidden = false; stopNotice.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      startButton.disabled = true;
      try {
        const consent = formToObject(form);
        snapshotForm(form);
        await backend.start(consent);
        adoptSessionState(backend.session);
        updateSavedIndicator("saved");
        navigateWithQuery("background.html");
      }
      catch (error) { updateSavedIndicator("error"); startButton.disabled = false; }
    });
  }
  function initializeStandardForm(form) {
    if (!form.dataset.nextPage) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = window.PrototypeValidation.validateForm(form);
      const summary = document.querySelector("[data-error-summary]");
      if (!result.valid) { if (summary) { summary.hidden = false; const count = summary.querySelector("[data-error-count]"); if (count) count.textContent = result.invalidCount; } return; }
      if (summary) summary.hidden = true;
      const button = form.querySelector("button[type=submit]"); button.disabled = true;
      try { await saveForm(form); navigateWithQuery(form.dataset.nextPage); } catch (error) { button.disabled = false; }
    });
  }
  function initializeWorkflowNavigation(form) {
    document.querySelectorAll("a[data-preserve-query]").forEach((link) => link.addEventListener("click", async (event) => {
      const target = new URL(link.href, window.location.href);
      if (!window.InterviewBackend.shouldSaveBeforeNavigation(backend.session, window.location.href, target.href)) return;
      event.preventDefault();
      if (navigationPending || !form) return;
      navigationPending = true;
      window.clearTimeout(saveTimer);
      try {
        await saveForm(form);
        navigateTo(target.href);
      } catch (error) { navigationPending = false; }
    }));
  }
  function initializeAudioSection() {
    const section = document.querySelector("[data-audio-section]");
    if (!section) return;
    const consent = state.forms && state.forms.consent;
    const link = section.querySelector("[data-whatsapp-placeholder]");
    const action = section.querySelector("[data-whatsapp-action]");
    const whatsAppUrl = String((backend.session && backend.session.whatsAppUrl) || "");
    const available = Boolean(consent && consent.audio_consent === "yes" && whatsAppUrl);
    section.hidden = !available;
    if (action) action.hidden = !available;
    if (!link) return;
    link.removeAttribute("href");
    link.removeAttribute("target");
    link.setAttribute("aria-disabled", "true");
    if (available) {
      link.href = whatsAppUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
      link.removeAttribute("aria-disabled");
    }
  }
  function initializeNewPublicResponse() {
    document.querySelectorAll("[data-reset-prototype]").forEach((button) => button.addEventListener("click", () => {
      if (!window.confirm("Start a new public response? / هل تريد بدء إجابة عامة جديدة؟")) return;
      clearStoredState(); window.InterviewBackend.clearSession();
      window.location.href = new URL("index.html?mode=public", window.location.href).href;
    }));
  }
  function lockCompleted(form) {
    form.querySelectorAll("input, textarea, select, button[type=submit]").forEach((control) => { control.disabled = true; });
    const success = document.querySelector("[data-submission-success]");
    if (success) { success.hidden = false; success.querySelector("h3").textContent = "Interview submitted / تم إرسال المقابلة"; }
  }
  function showConnectionError(error) {
    const main = document.querySelector("main");
    const notice = document.createElement("div"); notice.className = "error-summary"; notice.setAttribute("role", "alert");
    const heading = document.createElement("h3"); heading.textContent = "Interview service unavailable / خدمة المقابلة غير متاحة";
    const message = document.createElement("p"); message.textContent = String(error && error.message ? error.message : error);
    notice.appendChild(heading); notice.appendChild(message);
    main.prepend(notice);
    document.querySelectorAll("form input, form textarea, form select, form button").forEach((control) => { control.disabled = true; });
  }
  async function initialize() {
    preserveQueryParameters(); backend = new window.InterviewBackend.InterviewBackend();
    if (backend.mode === "public") { try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) { /* Remove legacy public cache when possible. */ } }
    state = readState();
    try {
      const session = await backend.initialize();
      if (enforceStartRoute(session)) return;
      if (enforceCompletedRoute(session)) return;
      adoptSessionState(session);
      initializeParticipantMode(session);
      const forms = Array.from(document.querySelectorAll("form[data-prototype-form]"));
      forms.forEach((form) => {
        restoreForm(form); initializeOtherFields(form); initializeNoneOptions(form);
        if (form.id === "consentForm") initializeConsent(form);
        else {
          form.addEventListener("input", () => scheduleSave(form, 1000));
          form.addEventListener("change", () => scheduleSave(form, 180));
          if (form.id !== "interviewForm") initializeStandardForm(form);
        }
        if (session.completed) lockCompleted(form);
      });
      initializeWorkflowNavigation(forms[0] || null);
      initializeAudioSection(); initializeNewPublicResponse();
      updateSavedIndicator(window.InterviewBackend.shouldShowSaved(session) ? "saved" : "waiting");
      document.dispatchEvent(new CustomEvent("thesis:app-ready", { detail: { completed: Boolean(session.completed) } }));
    } catch (error) { showConnectionError(error); }
  }
  window.PrototypeApp = {
    STORAGE_KEY, formToObject, navigateWithQuery, readState: () => state, saveForm,
    submitInterview: async (form, submissionKey) => {
      snapshotForm(form);
      const result = await backend.submit(state.forms, submissionKey);
      state = { forms: {}, sessionIdentity: backend.session.sessionIdentity, completed: true, participantReference: backend.session.participantReference };
      clearStoredState();
      return result;
    },
    writeState
  };
  document.addEventListener("DOMContentLoaded", initialize);
})();
