import React from "react";
import { createRoot } from "react-dom/client";
import "@motion-levels-games/display-kit/styles.css";
import "./styles.css";
import { App } from "./App.tsx";
import { installFavicon } from "./favicon.ts";

installFavicon();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
