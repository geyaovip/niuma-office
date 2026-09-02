const menu = document.querySelector<HTMLButtonElement>("[data-menu]");
const navigation = document.querySelector<HTMLElement>("[data-navigation]");
menu?.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") === "true";
  menu.setAttribute("aria-expanded", String(!open));
  navigation?.toggleAttribute("data-open", !open);
});

const year = document.querySelector<HTMLElement>("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());
