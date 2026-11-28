# UX-R1.0B.2 — isolated browser transport probe

The b028018f WebKit artifact reported 45 pageerror transport messages, zero native error/unhandledrejection events, and zero exact requestfailed correlations. There were 36 Firestore channel messages and nine HTTP callable messages. This is not proof of a false positive.

The probe uses only synthetic loopback servers, pinned Playwright 1.56.1, and the normal browser CORS policy. For each engine it compares fetch/XHR, same/cross origin, routed/direct requests, and pending request completion with/without navigation (16 cases). A successful CORS request and a deliberately rejected synthetic CORS request serve as controls for both routing modes. It preserves raw synthetic observations and does not change the application or certification thresholds. A green probe is evidence of completed controls, not browser certification. Inspect the JSON before making any classification or change to the real gate.
