import React from "react";
import { createRoot } from "react-dom/client";
import "@motion-levels-games/display-kit/styles.css";
import "./styles.css";
import { App } from "./App.tsx";
import { installFavicon } from "./favicon.ts";

installFavicon();

const rootElement = document.getElementById("root")!;

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function revealPlayground(): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    // Font readiness is an enhancement; layout still settles across two paints.
  }

  await afterNextPaint();
  await afterNextPaint();

  rootElement.setAttribute("aria-busy", "false");
  document.documentElement.classList.add("playground-ready");

  window.setTimeout(() => {
    document.getElementById("app-loading-screen")?.remove();
  }, 220);
}

void revealPlayground();
