(function () {
  "use strict";
  let submitting = false;
  const REQUIRED_HEADING = "Required responses are missing / توجد إجابات مطلوبة غير مكتملة";
  const REQUIRED_MESSAGE = "Please complete all highlighted main answers and every row in the Q4 and Q5 comparison tables. / يرجى إكمال جميع الإجابات الرئيسية المحددة وكل صف في جدولي المقارنة للسؤالين Q4 وQ5.";
  const requirements = {
    q1: { fields: ["q1_answer"] }, q2: { fields: ["q2_answer"] }, q3: { fields: ["q3_answer"] },
    q4: { fields: ["q4_answer"], groups: ["q4_query", "q4_volume", "q4_scaling"] },
    q5: { fields: ["q5_answer"], groups: ["q5_cost", "q5_overhead", "q5_predictability"] },
    q6: { fields: ["q6_answer"] }, q7: { fields: ["q7_answer"] }, q8: { fields: ["q8_answer"] }
  };
  function answered(form, requirement) {
    return requirement.fields.every((name) => form.elements[name] && String(form.elements[name].value || "").trim()) && (requirement.groups || []).every((name) => form.querySelector(`input[name='${name}']:checked`));
  }
  function updateProgress(form) {
    let count = 0;
    Object.entries(requirements).forEach(([key, requirement]) => {
      const complete = answered(form, requirement); if (complete) count += 1;
      const jump = document.querySelector(`[data-question-jump='${key}']`); if (jump) jump.classList.toggle("answered", complete);
    });
    document.querySelectorAll("[data-answered-count]").forEach((item) => { item.textContent = count; });
  }
  function validateComparisons(prefix) {
    const block = document.querySelector(`[data-comparison-block='${prefix}']`);
    const missing = Array.from(block.querySelectorAll("tbody tr[data-required-group]")).filter((row) => !row.querySelector("input:checked"));
    block.querySelectorAll("tbody tr").forEach((row) => row.classList.remove("field-error")); missing.forEach((row) => row.classList.add("field-error"));
    const message = block.querySelector(".validation-message"); if (message) message.classList.toggle("visible", Boolean(missing.length));
    return !missing.length;
  }
  function lock(form) { form.querySelectorAll("input, textarea, select, button[type=submit]").forEach((control) => { control.disabled = true; }); }
  function submissionKey() {
    const state = window.PrototypeApp.readState();
    if (!state.submissionKey) {
      const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
      state.submissionKey = Array.from(bytes, (item) => item.toString(36).padStart(2, "0")).join("");
      window.PrototypeApp.writeState(state);
    }
    return state.submissionKey;
  }
  function initialize(event) {
    const form = document.getElementById("interviewForm"); if (!form) return;
    updateProgress(form); form.addEventListener("input", () => updateProgress(form)); form.addEventListener("change", () => updateProgress(form));
    if (event.detail.completed) { lock(form); window.PrototypeApp.showSubmissionSuccess(); return; }
    form.addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      if (submitting) return;
      const valid = window.PrototypeValidation.validateForm(form, { scroll: false, focus: false });
      const tablesValid = validateComparisons("q4") && validateComparisons("q5");
      const summary = document.querySelector("[data-interview-error-summary]");
      if (!valid.valid || !tablesValid) {
        summary.querySelector("h3").textContent = REQUIRED_HEADING;
        summary.querySelector("p").textContent = REQUIRED_MESSAGE;
        summary.hidden = false; summary.scrollIntoView({ behavior: "smooth", block: "center" });
        const first = form.querySelector(".field-error"); if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      summary.hidden = true;
      const button = form.querySelector("button[type=submit]");
      submitting = true;
      button.disabled = true;
      button.textContent = "Submitting interview… / جارٍ إرسال المقابلة…";
      try {
        await window.PrototypeApp.submitInterview(form, submissionKey()); lock(form);
        const success = window.PrototypeApp.showSubmissionSuccess(); success.scrollIntoView({ behavior: "smooth", block: "start" }); success.focus({ preventScroll: true });
      } catch (error) {
        submitting = false;
        button.disabled = false;
        button.textContent = "Submit Interview / إرسال المقابلة";
        summary.hidden = false;
        summary.querySelector("h3").textContent = error.code === "SUBMISSION_UNCONFIRMED"
          ? "Submission status could not be confirmed / تعذر تأكيد حالة الإرسال"
          : "Interview was not submitted / لم يتم إرسال المقابلة";
        summary.querySelector("p").textContent = error.message;
      }
    });
  }
  document.addEventListener("thesis:app-ready", initialize);
})();
