// Apply the saved preference before the styles load.
(() => {
  const key = "garmin-dashboard-theme";
  const options = ["system", "light", "dark"];
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  let preference = "system";
  try {
    const saved = localStorage.getItem(key);
    if (options.includes(saved)) preference = saved;
  } catch {
    // The theme can still follow the system or be changed for this tab.
  }

  function apply() {
    const theme = preference === "system" ? (system.matches ? "dark" : "light") : preference;
    const changed = root.dataset.theme !== theme;
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    for (const picker of document.querySelectorAll("[data-theme-picker]")) picker.value = preference;
    if (changed) document.dispatchEvent(new Event("garmin-theme-change"));
  }

  apply();
  system.addEventListener("change", apply);
  document.addEventListener("change", (event) => {
    if (!event.target.matches("[data-theme-picker]") || !options.includes(event.target.value)) return;
    preference = event.target.value;
    try {
      localStorage.setItem(key, preference);
    } catch {
      // Keep the new preference until this tab closes or reloads.
    }
    apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    preference = options.includes(event.newValue) ? event.newValue : "system";
    apply();
  });
})();
