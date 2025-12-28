// 主题偏好存储键：保存在 localStorage 中
const THEME_KEY = "gemini_theme";

// 读取用户选择（light/dark/system），默认跟随系统
const getThemePreference = () => localStorage.getItem(THEME_KEY) || "system";

// 根据用户偏好解析出最终主题（system 会根据系统设置决定）
const resolveTheme = (preference) => {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return preference;
};

// 把主题写入 data-theme，让 CSS 可以用属性选择器切换样式
const applyTheme = () => {
  const preference = getThemePreference();
  const theme = resolveTheme(preference);
  document.body.dataset.theme = theme;
};

// 保存用户偏好，并立即应用
const setThemePreference = (value) => {
  localStorage.setItem(THEME_KEY, value);
  applyTheme();
};

// 暴露到全局，供 settings.js 调用
window.GeminiTheme = {
  applyTheme,
  setThemePreference,
  getThemePreference,
};

// 监听系统主题变化：只有在“跟随系统”时才自动切换
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getThemePreference() === "system") {
    applyTheme();
  }
});

// DOM 就绪后应用主题，避免闪烁
document.addEventListener("DOMContentLoaded", applyTheme);
