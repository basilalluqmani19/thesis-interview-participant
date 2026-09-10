# Master’s Thesis Interview — Public Participant Frontend

Static bilingual participant frontend for the data-collection phase of:

> Transition from Data Warehouse to Data Lakehouse: A Comparative Study between Traditional and Modern Models.

The approved HTML/CSS design is preserved. This public repository contains participant-facing code only. Researcher administration, Spreadsheet access, names, participant mappings, and research responses belong in the separate private Apps Script project.

## Structure

```text
public-frontend/
├── index.html
└── participant/
    ├── index.html
    ├── background.html
    ├── tools.html
    ├── interview.html
    ├── css/styles.css
    ├── js/
    │   ├── config.js
    │   ├── backend.js
    │   ├── validation.js
    │   ├── app.js
    │   └── interview.js
    └── assets/images/imamu-university-logo.png
```

## Local review

Serve the folder with any static server, for example:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/`. The single configuration file already contains the requested deployed public Apps Script `/exec` URL. Live backend operations still require that deployment to allow the exact participant-site origin used for the review.

## Integration behavior

- private links use only an opaque `token` query parameter;
- public participation creates a server-side `PUB-YYYYMMDD-HHMMSS-XXXX` session;
- consent, field changes, Background, Tools, Q1–Q8, Q4/Q5, and Closing are retained locally and do not call the backend;
- Background and Tools Continue validate locally, store locally, and navigate immediately with zero answer-persistence requests;
- Back and internal workflow navigation snapshot locally and navigate immediately without a server draft save;
- no “Not saved yet,” automatic “Saving…,” or “Saved ✓” status is displayed;
- active duration begins after Start Interview, accumulates while the page is visible, is carried across internal navigation, and is sent with final submission;
- Start Interview sends affirmative participation consent in the same server operation that changes the session to In Progress;
- internal workflow links and Q1–Q8 anchors remain immediate and never save answers to the server;
- final submission sends Consent, Background, Tools, Q1–Q8, Q4/Q5 structured selections and explanations, and Closing as one complete payload; it uses a stable idempotency key, blocks double-clicks, and verifies completion after an uncertain response;
- after successful public submission only, the participant may create a completely new server session; the action clears the completed same-tab state before returning to Consent and is never offered to a private participant;
- the editable form disappears after completion; WhatsApp appears only inside the completed state when audio consent is Yes and the server returns a configured link;
- client-side validation improves UX, while the server repeats all security-relevant validation.

Browser storage is only a same-browser/device convenience cache and is never authorization. It does not provide cross-device Resume Later. A short token-bound internal-navigation handoff avoids redundant private-token validation while carrying the local state between approved pages. Cached data from another participant is never merged. Public forms/secrets use same-tab storage and are restored only through a short internal-navigation handoff, so a fresh Public Link visit does not automatically display a previous visitor’s content. Successful final submission removes cached full answers. Participant identifiers remain internal and are not rendered in participant-visible HTML. The private token remains the server authority, completed private-token responses do not return submitted answers, and completed records cannot be edited even if browser state is changed.

## Public repository boundary

Publish only this participant frontend. Do not add the Admin Apps Script source, Spreadsheet ID, participant mappings, responses, real phone numbers, or any secret/private configuration to this repository.
