(function () {
  "use strict";

  const SESSION_KEY = "thesisInterviewSession.v2";
  const NAVIGATION_HANDOFF_KEY = "thesisInterviewNavigation.v1";
  const PRIVATE_NAVIGATION_HANDOFF_KEY = "thesisInterviewPrivateNavigation.v1";
  const NAVIGATION_HANDOFF_MS = 120000;

  function hasOwn(object, key) {
    return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
  }

  function plainObject(value) {
    return Boolean(value) && Object.prototype.toString.call(value) === "[object Object]";
  }

  function serverNumber(object, key) {
    if (!hasOwn(object, key)) return 0;
    const numeric = Number(object[key]);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  }

  function sessionIdentity(sourceType, participantReference, token) {
    return [sourceType || "", participantReference || "", token || ""].join(":");
  }

  function buildAuthoritativeSession(value, token, backendUrl) {
    const server = plainObject(value) ? value : {};
    const sourceType = String(server.sourceType || "");
    const participantReference = String(server.participantReference || "");
    const status = String(server.status || "NOT_STARTED");
    const sessionToken = String(token || "");
    return {
      participantReference,
      sourceType,
      status,
      startedAt: String(server.startedAt || ""),
      activeDurationSeconds: serverNumber(server, "activeDurationSeconds"),
      completionCount: serverNumber(server, "completionCount"),
      submittedAt: String(server.submittedAt || ""),
      forms: plainObject(server.draft) ? server.draft : {},
      whatsAppUrl: String(server.whatsAppUrl || ""),
      token: sessionToken,
      backendUrl,
      completed: status === "COMPLETED",
      sessionIdentity: sessionIdentity(sourceType, participantReference, sessionToken)
    };
  }

  function canResumePublicSession(cached, backendUrl) {
    if (!canRestorePublicNavigationSession(cached, backendUrl)) return false;
    return cached.status === "IN_PROGRESS";
  }

  function canRestorePublicNavigationSession(cached, backendUrl) {
    if (!plainObject(cached) || cached.backendUrl !== backendUrl || cached.sourceType !== "PUBLIC") return false;
    if (typeof cached.token !== "string" || !cached.token || typeof cached.participantReference !== "string" || !/^PUB-/.test(cached.participantReference)) return false;
    if (!["NOT_STARTED", "IN_PROGRESS"].includes(cached.status)) return false;
    const expectedIdentity = sessionIdentity("PUBLIC", cached.participantReference, cached.token);
    return !cached.sessionIdentity || cached.sessionIdentity === expectedIdentity;
  }

  function shouldOfferNewPublicResponse(mode, session) {
    return mode === "public" && Boolean(session && session.status === "COMPLETED" && session.completed === true);
  }

  function restorePublicSession(cached, backendUrl) {
    const status = String(cached.status || "IN_PROGRESS");
    const restored = {
      participantReference: String(cached.participantReference),
      sourceType: "PUBLIC",
      status,
      startedAt: String(cached.startedAt || ""),
      activeDurationSeconds: serverNumber(cached, "activeDurationSeconds"),
      completionCount: serverNumber(cached, "completionCount"),
      submittedAt: String(cached.submittedAt || ""),
      forms: plainObject(cached.forms) ? cached.forms : {},
      whatsAppUrl: String(cached.whatsAppUrl || ""),
      token: String(cached.token),
      backendUrl,
      completed: status === "COMPLETED"
    };
    restored.sessionIdentity = sessionIdentity(restored.sourceType, restored.participantReference, restored.token);
    return restored;
  }

  function shouldTrackDuration(session) {
    return Boolean(session && session.status === "IN_PROGRESS" && session.startedAt);
  }

  function participantPageName(href) {
    try {
      const parts = new URL(String(href || "")).pathname.split("/");
      return String(parts.pop() || "index.html").toLowerCase();
    } catch (error) {
      return "";
    }
  }

  function shouldRedirectToWelcome(session, href) {
    if (!session || session.status !== "NOT_STARTED") return false;
    return ["background.html", "tools.html", "interview.html"].includes(participantPageName(href));
  }

  function welcomeUrl(href) {
    const current = new URL(String(href));
    const target = new URL("index.html", current.href);
    target.search = current.search;
    return target.href;
  }

  function shouldRedirectCompletedToInterview(session, href) {
    return Boolean(session && session.sourceType === "PRIVATE" && session.status === "COMPLETED" && participantPageName(href) !== "interview.html");
  }

  function interviewUrl(href) {
    const current = new URL(String(href));
    const target = new URL("interview.html", current.href);
    target.search = current.search;
    return target.href;
  }

  function isAllowedBridgeOrigin(origin) {
    return origin === "https://script.google.com" || /^https:\/\/[a-z0-9-]*\.?googleusercontent\.com$/i.test(origin);
  }

  function randomId() {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (item) => item.toString(36).padStart(2, "0")).join("");
  }

  function transientStorage() {
    try { return window.sessionStorage || window.localStorage; } catch (error) { return window.localStorage; }
  }
  function readSession() {
    try { return JSON.parse(transientStorage().getItem(SESSION_KEY)) || {}; } catch (error) { return {}; }
  }
  function writeSession(state) {
    try {
      transientStorage().setItem(SESSION_KEY, JSON.stringify(state));
      window.localStorage.removeItem(SESSION_KEY);
    } catch (error) { /* Same-tab navigation cache only. */ }
  }
  function clearSession() {
    try {
      transientStorage().removeItem(SESSION_KEY);
      transientStorage().removeItem(NAVIGATION_HANDOFF_KEY);
      transientStorage().removeItem(PRIVATE_NAVIGATION_HANDOFF_KEY);
    } catch (error) { /* Best effort. */ }
    try { window.localStorage.removeItem(SESSION_KEY); } catch (error) { /* Remove legacy cache when possible. */ }
  }

  function publicNavigationHandoff(session, targetHref, now) {
    if (!canRestorePublicNavigationSession(session, session && session.backendUrl)) return null;
    const target = new URL(String(targetHref));
    return {
      sessionIdentity: sessionIdentity("PUBLIC", session.participantReference, session.token),
      destination: target.pathname + target.search,
      expiresAt: Number(now || Date.now()) + NAVIGATION_HANDOFF_MS
    };
  }

  function validPublicNavigationHandoff(cached, handoff, currentHref, backendUrl, now) {
    if (!canRestorePublicNavigationSession(cached, backendUrl) || !plainObject(handoff)) return false;
    const current = new URL(String(currentHref));
    const expectedIdentity = sessionIdentity("PUBLIC", cached.participantReference, cached.token);
    return handoff.sessionIdentity === expectedIdentity && handoff.destination === current.pathname + current.search && Number(handoff.expiresAt) >= Number(now || Date.now());
  }

  function preparePublicNavigation(session, targetHref) {
    try {
      const handoff = publicNavigationHandoff(session, targetHref, Date.now());
      if (!handoff) return false;
      transientStorage().setItem(NAVIGATION_HANDOFF_KEY, JSON.stringify(handoff));
      return true;
    } catch (error) {
      return false;
    }
  }

  function privateNavigationHandoff(session, token, targetHref, now) {
    if (!session || session.sourceType !== "PRIVATE" || session.status !== "IN_PROGRESS" || !token || !session.participantReference) return null;
    const target = new URL(String(targetHref));
    return {
      sessionIdentity: sessionIdentity("PRIVATE", session.participantReference, token),
      destination: target.pathname + target.search,
      expiresAt: Number(now || Date.now()) + NAVIGATION_HANDOFF_MS,
      session: {
        participantReference: session.participantReference,
        sourceType: "PRIVATE",
        status: "IN_PROGRESS",
        startedAt: session.startedAt || "",
        activeDurationSeconds: serverNumber(session, "activeDurationSeconds"),
        completionCount: serverNumber(session, "completionCount"),
        submittedAt: "",
        draft: plainObject(session.forms) ? session.forms : {},
        whatsAppUrl: session.whatsAppUrl || ""
      }
    };
  }

  function validPrivateNavigationHandoff(handoff, token, currentHref, backendUrl, now) {
    if (!plainObject(handoff) || !plainObject(handoff.session) || !token) return false;
    const current = new URL(String(currentHref));
    const expectedIdentity = sessionIdentity("PRIVATE", handoff.session.participantReference, token);
    return handoff.session.sourceType === "PRIVATE" && handoff.session.status === "IN_PROGRESS" &&
      handoff.sessionIdentity === expectedIdentity && handoff.destination === current.pathname + current.search &&
      Number(handoff.expiresAt) >= Number(now || Date.now()) && /^https:\/\//.test(backendUrl || "");
  }

  function preparePrivateNavigation(session, token, targetHref) {
    try {
      const handoff = privateNavigationHandoff(session, token, targetHref, Date.now());
      if (!handoff) return false;
      transientStorage().setItem(PRIVATE_NAVIGATION_HANDOFF_KEY, JSON.stringify(handoff));
      return true;
    } catch (error) {
      return false;
    }
  }

  function consumePrivateNavigationHandoff(token, currentHref, backendUrl) {
    var handoff = null;
    try {
      const storage = transientStorage();
      handoff = JSON.parse(storage.getItem(PRIVATE_NAVIGATION_HANDOFF_KEY) || "null");
      storage.removeItem(PRIVATE_NAVIGATION_HANDOFF_KEY);
    } catch (error) { handoff = null; }
    return validPrivateNavigationHandoff(handoff, token, currentHref, backendUrl, Date.now()) ? handoff.session : null;
  }

  function prepareSessionNavigation(session, token, targetHref) {
    return session && session.sourceType === "PRIVATE"
      ? preparePrivateNavigation(session, token, targetHref)
      : preparePublicNavigation(session, targetHref);
  }

  function consumePublicNavigationHandoff(cached, currentHref, backendUrl) {
    var handoff = null;
    try {
      const storage = transientStorage();
      handoff = JSON.parse(storage.getItem(NAVIGATION_HANDOFF_KEY) || "null");
      storage.removeItem(NAVIGATION_HANDOFF_KEY);
    } catch (error) { handoff = null; }
    return validPublicNavigationHandoff(cached, handoff, currentHref, backendUrl, Date.now());
  }

  function completedClientSession(previous, result) {
    const sourceType = String((previous && previous.sourceType) || "");
    const participantReference = String((result && result.participantReference) || (previous && previous.participantReference) || "");
    return {
      participantReference,
      sourceType,
      status: "COMPLETED",
      submittedAt: String((result && result.submittedAt) || ""),
      completionCount: 8,
      completed: true,
      forms: {},
      token: "",
      whatsAppUrl: String((result && result.whatsAppUrl) || ""),
      activeDurationSeconds: 0,
      sessionIdentity: sessionIdentity(sourceType, participantReference, "")
    };
  }

  class BridgeClient {
    constructor(url) {
      this.url = url;
      this.channel = randomId();
      this.pending = new Map();
      this.frame = document.createElement("iframe");
      this.frame.hidden = true;
      this.frame.title = "Interview service connection";
      this.frame.name = `interview-service-${randomId()}`;
      this.frame.src = "about:blank";
      window.addEventListener("message", (event) => this.handleMessage(event));
      document.body.appendChild(this.frame);
      this.queue = Promise.resolve();
    }
    handleMessage(event) {
      if (!isAllowedBridgeOrigin(event.origin)) return;
      const message = event.data || {};
      if (message.channel !== this.channel || message.type !== "interview-bridge-response") return;
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      window.clearTimeout(pending.timer);
      if (message.response && message.response.ok) pending.resolve(message.response.data);
      else {
        const failure = new Error(message.response && message.response.error ? message.response.error.message : "The request failed.");
        failure.code = message.response && message.response.error ? message.response.error.code : "REQUEST_FAILED";
        pending.reject(failure);
      }
    }
    request(action, payload) {
      const run = () => this.post(action, payload);
      const result = this.queue.catch(() => {}).then(run);
      this.queue = result.catch(() => {});
      return result;
    }
    post(action, payload) {
      const requestId = randomId();
      return new Promise((resolve, reject) => {
        const timeoutMs = action === "submitInterview" ? 45000 : 30000;
        const timer = window.setTimeout(() => {
          this.pending.delete(requestId);
          const failure = new Error("The interview service request timed out.");
          failure.code = "REQUEST_TIMEOUT";
          reject(failure);
        }, timeoutMs);
        this.pending.set(requestId, { resolve, reject, timer });
        const form = document.createElement("form");
        form.method = "POST"; form.action = this.url; form.target = this.frame.name; form.hidden = true;
        const fields = { channel: this.channel, requestJson: JSON.stringify({ action, requestId, payload }) };
        Object.entries(fields).forEach(([name, value]) => {
          const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input);
        });
        document.body.appendChild(form); form.submit(); form.remove();
      });
    }
  }

  class InterviewBackend {
    constructor() {
      this.config = window.INTERVIEW_APP_CONFIG || {};
      this.params = new URLSearchParams(window.location.search);
      this.mode = this.params.get("token") ? "private" : "public";
      this.token = this.params.get("token") || "";
      this.cachedSession = this.mode === "public" ? readSession() : {};
      this.session = {};
      this.activeSeconds = 0;
      this.lastTick = null;
      this.submitTimings = [];
    }
    configured() { return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(this.config.PUBLIC_BACKEND_URL || ""); }
    async initialize() {
      if (!this.configured()) throw new Error("The public interview backend has not been configured yet.");
      this.bridge = new BridgeClient(this.config.PUBLIC_BACKEND_URL);
      if (this.mode === "private") {
        const handedSession = consumePrivateNavigationHandoff(this.token, window.location.href, this.config.PUBLIC_BACKEND_URL);
        if (handedSession) {
          this.applySession(handedSession);
        } else {
          const action = participantPageName(window.location.href) === "index.html" ? "recordFirstOpen" : "validatePrivateToken";
          const validated = await this.bridge.request(action, { token: this.token });
          this.applySession(validated);
        }
      } else if (canRestorePublicNavigationSession(this.cachedSession, this.config.PUBLIC_BACKEND_URL) && consumePublicNavigationHandoff(this.cachedSession, window.location.href, this.config.PUBLIC_BACKEND_URL)) {
        this.token = this.cachedSession.token;
        this.session = restorePublicSession(this.cachedSession, this.config.PUBLIC_BACKEND_URL);
        this.activeSeconds = this.session.activeDurationSeconds;
        writeSession(this.session);
      } else {
        clearSession();
        this.session = {
          participantReference: "",
          sourceType: "PUBLIC",
          status: "NOT_STARTED",
          startedAt: "",
          activeDurationSeconds: 0,
          completionCount: 0,
          submittedAt: "",
          forms: {},
          whatsAppUrl: "",
          token: "",
          backendUrl: this.config.PUBLIC_BACKEND_URL,
          completed: false,
          sessionIdentity: "PUBLIC:PENDING:" + this.config.PUBLIC_BACKEND_URL
        };
        writeSession(this.session);
      }
      if (shouldTrackDuration(this.session)) this.startDurationTracking();
      return this.session;
    }
    applySession(value) {
      this.session = buildAuthoritativeSession(value, this.token, this.config.PUBLIC_BACKEND_URL);
      this.activeSeconds = this.session.activeDurationSeconds;
      if (this.mode === "public") writeSession(this.session); else clearSession();
    }
    startDurationTracking() {
      if (this.durationTimer) return;
      const tick = () => {
        const now = Date.now();
        if (this.lastTick && document.visibilityState === "visible") this.activeSeconds += Math.max(0, Math.min(5, (now - this.lastTick) / 1000));
        this.lastTick = now;
      };
      this.durationTick = tick;
      this.lastTick = Date.now();
      this.durationTimer = window.setInterval(tick, 1000);
      document.addEventListener("visibilitychange", tick);
    }
    stopDurationTracking() {
      if (this.durationTimer) window.clearInterval(this.durationTimer);
      if (this.durationTick) document.removeEventListener("visibilitychange", this.durationTick);
      this.durationTimer = null;
      this.durationTick = null;
      this.lastTick = null;
    }
    activeDuration() { return Math.min(604800, Math.max(0, Math.round(this.activeSeconds))); }
    async ensureSession(publicName) {
      if (this.token) return this.session;
      const created = await this.bridge.request("createPublicSession", { publicName: publicName || "" });
      this.token = created.sessionToken;
      this.applySession(created);
      return this.session;
    }
    async beginNewPublicResponse() {
      if (this.mode !== "public") throw new Error("A new public response is available only from the public interview.");
      this.stopDurationTracking();
      clearSession();
      this.token = "";
      this.cachedSession = {};
      this.session = {};
      this.activeSeconds = 0;
      const created = await this.bridge.request("createPublicSession", { publicName: "" });
      const newToken = String((created && created.sessionToken) || "");
      if (!newToken) throw new Error("A new public response could not be created.");
      this.token = newToken;
      this.applySession(created);
      if (this.session.sourceType !== "PUBLIC" || this.session.status !== "NOT_STARTED" || this.session.completed) {
        this.token = "";
        this.session = {};
        clearSession();
        throw new Error("A new public response could not be created.");
      }
      return this.session;
    }
    async start(consent) {
      const values = plainObject(consent) ? consent : {};
      await this.ensureSession(values.public_name || "");
      const payload = { token: this.token, participationConsent: String(values.participation_consent || "") };
      if (hasOwn(values, "audio_consent") && values.audio_consent) payload.audioConsent = String(values.audio_consent);
      const result = await this.bridge.request("startInterview", payload);
      this.applySession(result);
      if (shouldTrackDuration(this.session)) this.startDurationTracking();
      return result;
    }
    prepareNavigation(targetHref) {
      if (shouldTrackDuration(this.session)) {
        this.session.activeDurationSeconds = this.activeDuration();
        if (this.mode === "public") writeSession(this.session);
      }
      return prepareSessionNavigation(this.session, this.token, targetHref);
    }
    async save(page, pageData) {
      // Compatibility endpoint only. The participant workflow keeps answers local until final Submit.
      if (!this.token || !shouldTrackDuration(this.session)) throw new Error("Start the interview before saving a response.");
      const data = {};
      data[page] = pageData;
      const result = await this.bridge.request("saveDraft", { token: this.token, page, data, activeDurationSeconds: this.activeDuration() });
      this.session.forms = plainObject(this.session.forms) ? this.session.forms : {};
      this.session.forms[page] = pageData;
      this.session.activeDurationSeconds = this.activeDuration();
      this.session.completionCount = result.completionCount;
      this.session.whatsAppUrl = String(result.whatsAppUrl || "");
      writeSession(this.session);
      return result;
    }
    async submit(forms, submissionKey) {
      if (!this.token || !shouldTrackDuration(this.session)) throw new Error("Start the interview before submitting a response.");
      const payload = { token: this.token, data: forms, activeDurationSeconds: this.activeDuration(), submissionKey };
      const totalStartedAt = Date.now();
      var result;
      try {
        const primaryStartedAt = Date.now();
        result = await this.bridge.request("submitInterview", payload);
        this.recordSubmitTiming("submitInterview", primaryStartedAt);
      } catch (error) {
        this.recordSubmitTiming("submitInterview", totalStartedAt, error && error.code ? error.code : "ERROR");
        if (!this.isUncertainSubmissionError(error)) throw error;
        try {
          const verificationStartedAt = Date.now();
          const status = await this.bridge.request("getSubmissionStatus", { token: this.token, submissionKey });
          this.recordSubmitTiming("getSubmissionStatus", verificationStartedAt);
          if (status.status !== "COMPLETED") throw error;
          result = status;
        } catch (statusError) {
          if (statusError === error || statusError.code === "ALREADY_SUBMITTED") throw statusError;
          const unconfirmed = new Error("Submission could not be confirmed. Please try Submit again. / تعذر تأكيد الإرسال. يرجى محاولة الإرسال مرة أخرى.");
          unconfirmed.code = "SUBMISSION_UNCONFIRMED";
          throw unconfirmed;
        }
      }
      if (!result || result.status !== "COMPLETED") throw new Error("The interview was not completed.");
      this.stopDurationTracking();
      this.session = completedClientSession(this.session, result);
      this.token = "";
      this.activeSeconds = 0;
      clearSession();
      this.recordSubmitTiming("total", totalStartedAt);
      return result;
    }
    recordSubmitTiming(step, startedAt, outcome) {
      if (this.config.ENABLE_TEST_TIMING !== true) return;
      this.submitTimings.push({ step, durationMs: Math.max(0, Date.now() - startedAt), outcome: outcome || "OK" });
    }
    getSubmitTimings() {
      return this.config.ENABLE_TEST_TIMING === true ? this.submitTimings.slice() : [];
    }
    isUncertainSubmissionError(error) {
      return !error || !error.code || ["REQUEST_TIMEOUT", "REQUEST_FAILED", "SERVER_ERROR", "BUSY"].includes(error.code);
    }
  }

  window.InterviewBackend = { InterviewBackend, SESSION_KEY, NAVIGATION_HANDOFF_KEY, PRIVATE_NAVIGATION_HANDOFF_KEY, readSession, writeSession, clearSession, shouldTrackDuration, shouldRedirectToWelcome, shouldRedirectCompletedToInterview, welcomeUrl, interviewUrl, shouldOfferNewPublicResponse, buildAuthoritativeSession, canResumePublicSession, canRestorePublicNavigationSession, restorePublicSession, publicNavigationHandoff, validPublicNavigationHandoff, preparePublicNavigation, privateNavigationHandoff, validPrivateNavigationHandoff, preparePrivateNavigation, prepareSessionNavigation, completedClientSession, sessionIdentity };
})();
