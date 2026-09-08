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
- field changes update local validity immediately and do not call the backend;
- Background and Tools each make one page-specific save after a valid Continue click; a changed page makes at most one save before Back/workflow navigation;
- “Saving…” and “Saved ✓” are used only around those explicit operations;
- active duration begins after Start Interview, accumulates while the page is visible, is carried across internal navigation, and is sent during explicit saves/final submission;
- Start Interview sends affirmative participation consent in the same server operation that changes the session to In Progress;
- unchanged internal workflow links navigate without a save; changed pages wait for one confirmed page save, while Q1–Q8 anchors remain immediate;
- final submission uses a stable idempotency key, blocks double-clicks, verifies completion after an uncertain response, and locks completed interviews;
- after successful public submission only, the participant may create a completely new server session; the action clears the completed same-tab state before returning to Consent and is never offered to a private participant;
- WhatsApp opens only when audio consent is Yes and the server returns a configured link;
- client-side validation improves UX, while the server repeats all security-relevant validation.

Browser storage is only a convenience cache. A direct private-link load restores successfully saved pages from the server; a short token-bound internal-navigation handoff avoids an otherwise redundant validation call immediately after a valid session/save. Cached data from another participant is never merged. Public forms/secrets use same-tab storage and are restored only through a short internal-navigation handoff, so a fresh Public Link visit does not automatically display a previous visitor’s content. Successful final submission removes cached full answers. Participant identifiers remain internal and are not rendered in participant-visible HTML. The private token remains the server authority, completed private-token responses are not returned to the participant client, and completed records cannot be edited even if browser state is changed.

## Public repository boundary

Publish only this participant frontend. Do not add the Admin Apps Script source, Spreadsheet ID, participant mappings, responses, real phone numbers, or any secret/private configuration to this repository.
