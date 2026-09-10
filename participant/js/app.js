(function () {
  "use strict";

  const STORAGE_KEY = "thesisInterviewForms.v2";
  let backend;
  let state = { forms: {} };
  let navigationPending = false;
  let startPending = false;

  function formStorage() {
    return backend && backend.mode === "public" ? window.sessionStorage : window.localStorage;
  }

  function clearStoredState() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) { /* Best effort. */ }
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch (error) { /* Best effort. */ }
  }

  function readState() {
    try {
      const cached = JSON.parse(formStorage().getItem(STORAGE_KEY));
      return cached && Object.prototype.toString.call(cached.forms) === "[object Object]" ? cached : { forms: {} };
    } catch (error) {
      return { forms: {} };
    }
  }

  function writeState(next) {
    state = next;
    try { formStorage().setItem(STORAGE_KEY, JSON.stringify(next)); return true; } catch (error) { return false; }
  }

  function sessionForms(session) {
    return session && Object.prototype.toString.call(session.forms) === "[object Object]" ? session.forms : {};
  }

  function bindStateToBackendSession() {
    const identity = String((backend && backend.session && backend.session.sessionIdentity) || "");
    if (identity && state.sessionIdentity !== identity) {
      state.sessionIdentity = identity;
      delete state.submissionKey;
    }
  }

  function mirrorLocalFormsToSession() {
    if (!backend || !backend.session) return;
    backend.session.forms = state.forms || {};
  }

  function adoptSessionState(session) {
    const identity = String((session && session.sessionIdentity) || "");
    if (session && session.completed) {
      state = { forms: {}, sessionIdentity: identity, completed: true };
      clearStoredState();
      return;
    }
    const localForms = state && Object.prototype.toString.call(state.forms) === "[object Object]" ? state.forms : {};
    const remoteForms = sessionForms(session);
    if (!identity || state.sessionIdentity !== identity) {
      state = { forms: remoteForms, sessionIdentity: identity };
    } else {
      state.forms = Object.assign({}, remoteForms, localForms);
    }
    writeState(state);
    mirrorLocalFormsToSession();
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

  function storeLocalForm(form) {
    if (!form || !form.dataset.prototypeForm) return {};
    bindStateToBackendSession();
    const pageData = formToObject(form);
    state.forms = state.forms || {};
    state.forms[form.dataset.prototypeForm] = pageData;
    state.updatedAt = new Date().toISOString();
    writeState(state);
    mirrorLocalFormsToSession();
    return pageData;
  }

  function completeSubmissionPayload(forms) {
    const source = forms && Object.prototype.toString.call(forms) === "[object Object]" ? forms : {};
    return {
      consent: source.consent || {},
      background: source.background || {},
      tools: source.tools || {},
      interview: source.interview || {}
    };
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
    if (backend) backend.prepareNavigation(href);
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

  function initializeParticipantMode() {
    document.querySelectorAll("[data-public-only]").forEach((element) => { element.hidden = backend.mode !== "public"; });
    document.querySelectorAll("[data-reset-prototype], [data-public-success-action]").forEach((element) => { element.hidden = true; });
  }

  function showActionError(error) {
    const main = document.querySelector("main");
    if (!main) return;
    const existing = main.querySelector("[data-action-error]");
    if (existing) existing.remove();
    const notice = document.createElement("div");
    notice.className = "error-summary";
    notice.dataset.actionError = "true";
    notice.setAttribute("role", "alert");
    const heading = document.createElement("h3");
    heading.textContent = "The request could not be completed / تعذر إكمال الطلب";
    const message = document.createElement("p");
    message.textContent = String(error && error.message ? error.message : error);
    notice.appendChild(heading);
    notice.appendChild(message);
    main.prepend(notice);
  }

  function initializeConsent(form) {
    const startButton = document.querySelector("[data-start-interview]");
    const stopNotice = document.querySelector("[data-consent-stop]");
    const update = () => {
      storeLocalForm(form);
      const selected = form.querySelector("input[name=participation_consent]:checked");
      if (startButton && !startPending) startButton.disabled = !(selected && selected.value === "yes");
      if (stopNotice) stopNotice.hidden = !(selected && selected.value === "no");
    };
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    update();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (startPending) return;
      const selected = form.querySelector("input[name=participation_consent]:checked");
      if (!selected) return void window.PrototypeValidation.validateForm(form);
      if (selected.value !== "yes") {
        stopNotice.hidden = false;
        stopNotice.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const consent = storeLocalForm(form);
      startPending = true;
      startButton.disabled = true;
      try {
        await backend.start(consent);
        adoptSessionState(backend.session);
        navigateWithQuery("background.html");
      } catch (error) {
        startPending = false;
        startButton.disabled = false;
        showActionError(error);
      }
    });
  }

  function updateContinueState(form) {
    const button = form.querySelector("button[type=submit]");
    if (!button) return;
    const complete = window.PrototypeValidation.isFormComplete(form);
    if (complete) button.removeAttribute("aria-disabled");
    else button.setAttribute("aria-disabled", "true");
  }

  function markFormChanged(form) {
    storeLocalForm(form);
    updateContinueState(form);
  }

  function initializeStandardForm(form) {
    if (!form.dataset.nextPage) return;
    updateContinueState(form);
    form.addEventListener("input", () => markFormChanged(form));
    form.addEventListener("change", () => markFormChanged(form));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (navigationPending) return;
      const result = window.PrototypeValidation.validateForm(form);
      const summary = document.querySelector("[data-error-summary]");
      if (!result.valid) {
        if (summary) {
          summary.hidden = false;
          const count = summary.querySelector("[data-error-count]");
          if (count) count.textContent = result.invalidCount;
        }
        return;
      }
      if (summary) summary.hidden = true;
      navigationPending = true;
      storeLocalForm(form);
      navigateWithQuery(form.dataset.nextPage);
    });
  }

  function initializeWorkflowNavigation(form) {
    document.querySelectorAll("a[data-preserve-query]").forEach((link) => link.addEventListener("click", (event) => {
      if (!form || backend.session.completed) return;
      event.preventDefault();
      if (navigationPending) return;
      navigationPending = true;
      storeLocalForm(form);
      navigateTo(link.href);
    }));
  }

  function initializeAudioSection() {
    const section = document.querySelector("[data-audio-section]");
    if (!section) return;
    const link = section.querySelector("[data-whatsapp-placeholder]");
    const action = section.querySelector("[data-whatsapp-action]");
    const success = document.querySelector("[data-submission-success]");
    const whatsAppUrl = String((backend.session && backend.session.whatsAppUrl) || "");
    const available = Boolean(success && !success.hidden && whatsAppUrl);
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

  async function startNewPublicResponse(button) {
    button.disabled = true;
    clearStoredState();
    try {
      await backend.beginNewPublicResponse();
      state = { forms: {}, sessionIdentity: backend.session.sessionIdentity };
      writeState(state);
      const target = new URL("index.html?mode=public", window.location.href);
      backend.prepareNavigation(target.href);
      window.location.href = target.href;
    } catch (error) {
      button.disabled = false;
      showActionError(error);
      throw error;
    }
  }

  function initializeNewPublicResponse() {
    document.querySelectorAll("[data-reset-prototype]").forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("Start a new public response? / هل تريد بدء إجابة عامة جديدة؟")) return;
      try { await startNewPublicResponse(button); } catch (error) { /* The participant can safely try again. */ }
    }));
  }

  function hideCompletedInterviewContent() {
    document.querySelectorAll(".workflow-nav, .page-intro, .prototype-note, .question-progress, [data-interview-error-summary], #interviewForm").forEach((element) => {
      element.hidden = true;
    });
  }

  function showSubmissionSuccess() {
    const success = document.querySelector("[data-submission-success]");
    if (!success) return null;
    hideCompletedInterviewContent();
    success.hidden = false;
    const showNewPublicResponse = window.InterviewBackend.shouldOfferNewPublicResponse(backend.mode, backend.session);
    const action = success.querySelector("[data-public-success-action]");
    const button = success.querySelector("[data-reset-prototype]");
    if (action) action.hidden = !showNewPublicResponse;
    if (button) button.hidden = !showNewPublicResponse;
    initializeAudioSection();
    return success;
  }

  function lockCompleted(form) {
    form.querySelectorAll("input, textarea, select, button[type=submit]").forEach((control) => { control.disabled = true; });
    showSubmissionSuccess();
  }

  function showConnectionError(error) {
    const main = document.querySelector("main");
    const notice = document.createElement("div");
    notice.className = "error-summary";
    notice.setAttribute("role", "alert");
    const heading = document.createElement("h3");
    heading.textContent = "Interview service unavailable / خدمة المقابلة غير متاحة";
    const message = document.createElement("p");
    message.textContent = String(error && error.message ? error.message : error);
    notice.appendChild(heading);
    notice.appendChild(message);
    main.prepend(notice);
    document.querySelectorAll("form input, form textarea, form select, form button").forEach((control) => { control.disabled = true; });
  }

  async function initialize() {
    preserveQueryParameters();
    backend = new window.InterviewBackend.InterviewBackend();
    if (backend.mode === "public") {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (error) { /* Remove legacy public cache when possible. */ }
    }
    state = readState();
    try {
      const session = await backend.initialize();
      if (enforceStartRoute(session)) return;
      if (enforceCompletedRoute(session)) return;
      adoptSessionState(session);
      initializeParticipantMode();
      const forms = Array.from(document.querySelectorAll("form[data-prototype-form]"));
      forms.forEach((form) => {
        restoreForm(form);
        initializeOtherFields(form);
        initializeNoneOptions(form);
        if (session.completed) {
          lockCompleted(form);
          return;
        }
        if (form.id === "consentForm") initializeConsent(form);
        else if (form.id !== "interviewForm") initializeStandardForm(form);
        else {
          form.addEventListener("input", () => storeLocalForm(form));
          form.addEventListener("change", () => storeLocalForm(form));
        }
      });
      if (!session.completed) initializeWorkflowNavigation(forms[0] || null);
      initializeAudioSection();
      initializeNewPublicResponse();
      document.dispatchEvent(new CustomEvent("thesis:app-ready", { detail: { completed: Boolean(session.completed) } }));
    } catch (error) {
      showConnectionError(error);
    }
  }

  window.PrototypeApp = {
    STORAGE_KEY,
    formToObject,
    completeSubmissionPayload,
    navigateWithQuery,
    readState: () => state,
    showSubmissionSuccess,
    storeLocalForm,
    submitInterview: async (form, submissionKey) => {
      storeLocalForm(form);
      const finalPayload = completeSubmissionPayload(state.forms);
      const result = await backend.submit(finalPayload, submissionKey);
      state = { forms: {}, sessionIdentity: backend.session.sessionIdentity, completed: true };
      clearStoredState();
      return result;
    },
    writeState
  };

  document.addEventListener("DOMContentLoaded", initialize);
})();
