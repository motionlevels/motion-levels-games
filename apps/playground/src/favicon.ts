import faviconUrl from "./assets/motion-levels-favicon.png";

export function installFavicon(): void {
  const existing = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  const link = existing ?? document.createElement("link");

  link.rel = "icon";
  link.type = "image/png";
  link.href = faviconUrl;

  if (!existing) {
    document.head.appendChild(link);
  }
}
