import React from "react";
import { createRoot } from "react-dom/client";
import "@motion-levels-games/display-kit/styles.css";
import "./styles.css";
import { App } from "./App.tsx";
import { installFavicon } from "./favicon.ts";

installFavicon();

const rootElement = document.getElementById("root")!;
const FONT_READY_TIMEOUT_MILLIS = 1_500;

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function waitForFonts(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };

    timeout = window.setTimeout(finish, FONT_READY_TIMEOUT_MILLIS);
    try {
      void document.fonts.ready.then(finish, finish);
    } catch {
      finish();
    }
  });
}

async function revealPlayground(): Promise<void> {
  // Font readiness improves the first layout but must never block the venue
  // playground indefinitely when a font request is slow or unavailable.
  await waitForFonts();

  await afterNextPaint();
  await afterNextPaint();

  rootElement.setAttribute("aria-busy", "false");
  document.documentElement.classList.add("playground-ready");

  window.setTimeout(() => {
    document.getElementById("app-loading-screen")?.remove();
  }, 220);
}

void revealPlayground();
