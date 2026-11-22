import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import nl from "./locales/nl.json";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "nl", label: "Nederlands" },
] as const;

const KEY = "netsim-lang";

function initialLanguage(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "en" || stored === "nl") return stored;
  } catch {
    // ignore
  }
  return navigator.language.toLowerCase().startsWith("nl") ? "nl" : "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, nl: { translation: nl } },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(KEY, lng);
  } catch {
    // ignore
  }
});
document.documentElement.lang = i18n.language;

export default i18n;
