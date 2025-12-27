const THEME_KEY = "gemini_theme";

const getThemePreference = () => localStorage.getItem(THEME_KEY) || "system";

const resolveTheme = (preference) => {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return preference;
};

const applyTheme = () => {
  const preference = getThemePreference();
  const theme = resolveTheme(preference);
  document.body.dataset.theme = theme;
};

const setThemePreference = (value) => {
  localStorage.setItem(THEME_KEY, value);
  applyTheme();
};

window.GeminiTheme = {
  applyTheme,
  setThemePreference,
  getThemePreference,
};

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getThemePreference() === "system") {
    applyTheme();
  }
});

document.addEventListener("DOMContentLoaded", applyTheme);
