import { StrictMode, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import App from "./App";
import "./styles.css";

const kioskDesignWidth = 1920;
const kioskDesignHeight = 1080;

function kioskScale() {
  if (fixedKioskPreviewViewport()) return 1;
  const viewport = window.visualViewport;
  const width = viewport?.width || window.innerWidth || kioskDesignWidth;
  const height = viewport?.height || window.innerHeight || kioskDesignHeight;
  return Math.min(width / kioskDesignWidth, height / kioskDesignHeight);
}

function fixedKioskPreviewViewport() {
  return new URLSearchParams(window.location.search).get("kioskViewport") === `${kioskDesignWidth}x${kioskDesignHeight}`;
}

function KioskViewport({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(kioskScale);

  useEffect(() => {
    const update = () => {
      const next = kioskScale();
      setScale((current) => (Math.abs(current - next) < 0.001 ? current : next));
    };
    const viewport = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    viewport?.addEventListener("resize", update);
    update();
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      viewport?.removeEventListener("resize", update);
    };
  }, []);

  const stageStyle = {
    "--kiosk-scale": scale,
    "--kiosk-width": `${kioskDesignWidth * scale}px`,
    "--kiosk-height": `${kioskDesignHeight * scale}px`,
  } as CSSProperties;

  return (
    <div className="kiosk-viewport">
      <div className="kiosk-stage" style={stageStyle}>
        <div className="kiosk-frame">{children}</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KioskViewport>
      <App />
    </KioskViewport>
  </StrictMode>,
);
