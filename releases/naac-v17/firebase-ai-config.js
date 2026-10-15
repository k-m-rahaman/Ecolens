// Public Firebase web configuration and attestation site key only.
// No Gemini API keys, administrator credentials or debug tokens belong here.
export const FIREBASE_AI_CONFIG = Object.freeze({
  "firebase": {
    "apiKey": "AIzaSyC4oDzQ98HpW77QknAuUNUnJC3Rfu17LR4",
    "projectId": "ecolens-live",
    "appId": "1:409713978756:web:d453cdd0b251a4306241d1",
    "authDomain": "ecolens-live.firebaseapp.com"
  },
  "model": "gemini-3.5-flash-lite",
  "appCheck": {
    "provider": "recaptcha-enterprise",
    "siteKey": "6Lfsyu4tAAAAAEdVIS6osbvS8TWxYSNYQlnpYhcU"
  }
});
