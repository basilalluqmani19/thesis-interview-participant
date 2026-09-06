(function () {
  "use strict";

  const DEFAULT_MESSAGE = "Please complete this required item. / يرجى إكمال هذا الحقل المطلوب.";
  const GROUP_MESSAGE = "Please select at least one option. / يرجى اختيار خيار واحد على الأقل.";
  const OTHER_MESSAGE = "Please specify the Other option. / يرجى توضيح خيار أخرى.";

  function closestContainer(element) {
    return element.closest(".field-card, .tool-category, .question-card, .content-card") || element;
  }

  function getMessageElement(container) {
    return container.querySelector(":scope > .validation-message") || container.querySelector(".validation-message");
  }

  function markInvalid(container, message) {
    container.classList.add("field-error");
    const messageElement = getMessageElement(container);
    if (messageElement) {
      messageElement.textContent = message;
      messageElement.classList.add("visible");
    }
  }

  function clearErrors(form) {
    form.querySelectorAll(".field-error").forEach((element) => element.classList.remove("field-error"));
    form.querySelectorAll(".validation-message.visible").forEach((element) => {
      element.classList.remove("visible");
    });
    form.querySelectorAll("[aria-invalid='true']").forEach((element) => element.removeAttribute("aria-invalid"));
  }

  function validateForm(form, options) {
    const settings = Object.assign({ scroll: true, focus: true }, options || {});
    const invalidContainers = [];
    clearErrors(form);

    form.querySelectorAll("[data-required-group]").forEach((group) => {
      if (group.hidden || group.closest("[hidden]")) return;
      const selectable = Array.from(group.querySelectorAll("input[type='radio'], input[type='checkbox']")).filter(
        (input) => !input.disabled
      );
      if (!selectable.some((input) => input.checked)) {
        const container = closestContainer(group);
        markInvalid(container, group.dataset.errorMessage || GROUP_MESSAGE);
        selectable.forEach((input) => input.setAttribute("aria-invalid", "true"));
        invalidContainers.push({ container, focus: selectable[0] });
      }
    });

    form.querySelectorAll("[data-required-field]").forEach((field) => {
      if (field.disabled || field.hidden || field.closest("[hidden]")) return;
      if (!String(field.value || "").trim()) {
        const container = closestContainer(field);
        markInvalid(container, field.dataset.errorMessage || DEFAULT_MESSAGE);
        field.setAttribute("aria-invalid", "true");
        invalidContainers.push({ container, focus: field });
      }
    });

    form.querySelectorAll("[data-other-controller]").forEach((controller) => {
      if (!controller.checked) return;
      const target = form.querySelector(controller.dataset.otherController);
      if (!target || String(target.value || "").trim()) return;
      const container = closestContainer(controller);
      markInvalid(container, OTHER_MESSAGE);
      target.setAttribute("aria-invalid", "true");
      invalidContainers.push({ container, focus: target });
    });

    const uniqueInvalid = invalidContainers.filter(
      (item, index, array) => array.findIndex((candidate) => candidate.container === item.container) === index
    );

    if (uniqueInvalid.length && settings.scroll) {
      uniqueInvalid[0].container.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (uniqueInvalid.length && settings.focus && uniqueInvalid[0].focus) {
      window.setTimeout(() => uniqueInvalid[0].focus.focus({ preventScroll: true }), 350);
    }

    return {
      valid: uniqueInvalid.length === 0,
      invalidCount: uniqueInvalid.length,
      firstInvalid: uniqueInvalid[0] || null
    };
  }

  window.PrototypeValidation = {
    clearErrors,
    markInvalid,
    validateForm
  };
})();
