import { Component, StrictMode, useEffect, useState, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import App from "./App";
import { initMenuAnalytics } from "./analytics";
import MenuUpdateGate from "./MenuUpdateGate";
import { publicAssetURL } from "./utils";
import "./styles.css";

try {
  initMenuAnalytics();
} catch (error) {
  console.warn("Menu analytics could not be initialized", error);
}

const kioskDesignWidth = 1920;
const kioskDesignHeight = 1080;
const kioskBuildVersion = (
  <small
    className="kiosk-build-version"
    aria-label={`Versión desplegada: ${__MOTION_LEVELS_GAMES_BUILD_VERSION__}`}
  >
    {__MOTION_LEVELS_GAMES_BUILD_VERSION__}
  </small>
);

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
        <div className="kiosk-frame">
          {children}
          {kioskBuildVersion}
        </div>
      </div>
    </div>
  );
}

class KioskErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Player menu render failure", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app recovery-screen" role="alert">
        <section className="panel recovery-card">
          <img src={publicAssetURL("motion-levels-icon.webp")} alt="" />
          <span className="micro">Recuperación del quiosco</span>
          <h1>Vamos a volver a cargar el menú</h1>
          <p>La partida no se ha modificado. Pulsa el botón para reconectar esta pantalla.</p>
          <button className="btn primary" type="button" onClick={() => window.location.reload()}>
            Volver a cargar
          </button>
        </section>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KioskViewport>
      <MenuUpdateGate>
        <KioskErrorBoundary>
          <App />
        </KioskErrorBoundary>
      </MenuUpdateGate>
    </KioskViewport>
  </StrictMode>,
);
