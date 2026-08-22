import assert from "node:assert/strict";
import type { Page } from "playwright";

export type PlayerDisplayGeometryViolation = {
  code: string;
  element: string;
  detail: string;
};

export type PlayerDisplayGeometryReport = {
  display: { height: number; width: number };
  maxLives?: number;
  meters: number;
  phase?: string;
  slots: number;
  violations: PlayerDisplayGeometryViolation[];
};

/**
 * Validate the native player-display DOM before accepting a browser capture.
 *
 * The shared primitives mark containment contracts with data attributes. Class
 * selectors remain as a compatibility fallback so the gate also protects old
 * game displays during their migration. Intentional decorative overflow must
 * be explicit (`data-display-overflow="allow"`), and a purely decorative
 * subtree can opt out with `data-display-geometry="ignore"`.
 */
export async function assertPlayerDisplayGeometry(
  page: Page,
  captureName: string
): Promise<PlayerDisplayGeometryReport> {
  // tsx/esbuild can preserve its function-name helper in nested callbacks
  // serialized by Playwright. Define the no-op browser equivalent before the
  // evaluator runs; the helper has no effect on geometry or app state.
  await page.evaluate("globalThis.__name ||= ((target) => target)");
  const report = await page.evaluate(async (): Promise<PlayerDisplayGeometryReport> => {
    type Rect = { bottom: number; height: number; left: number; right: number; top: number; width: number };
    type PlaygroundWindow = Window & {
      ml?: { getState(): { snapshot: { lives?: number; maxLives?: number; phase?: string } } };
    };

    const rootSelector = "[data-display-root], .ml-display-shell";
    const containmentSelector = "[data-display-containment]";
    const markedSelector = [
      "[data-display-containment]",
      "[data-display-contained-by]",
      "[data-display-geometry='check']",
      "[data-display-item]",
      "[data-display-scale-envelope]",
      "[data-lives-meter]",
      "[data-life-slot]",
      ".ml-lives-meter",
      ".ml-life-heart"
    ].join(", ");
    const meterSelector = "[data-lives-meter], .ml-lives-meter";
    const slotSelector = "[data-life-slot], .ml-life-heart";
    const ignoredSelector = "[data-display-geometry='ignore']";
    const allowedOverflowSelector = "[data-display-overflow='allow']";
    const violations: PlayerDisplayGeometryViolation[] = [];
    const violationKeys = new Set<string>();

    function rectOf(element: Element): Rect {
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      };
    }

    function visible(element: Element): boolean {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
      if (Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0.5 && rect.height > 0.5;
    }

    function ignored(element: Element): boolean {
      return element.closest(ignoredSelector) !== null;
    }

    function allowsOverflow(element: Element): boolean {
      return element.matches(allowedOverflowSelector);
    }

    function describe(element: Element): string {
      const tag = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : "";
      const classes = Array.from(element.classList).slice(0, 3).map((name) => `.${name}`).join("");
      const contract = element.getAttribute("data-display-containment") !== null
        ? "[data-display-containment]"
        : element.getAttribute("data-lives-meter") !== null
          ? "[data-lives-meter]"
          : element.getAttribute("data-life-slot") !== null
            ? "[data-life-slot]"
            : "";
      return `${tag}${id}${classes}${contract}`;
    }

    function formatRect(rect: Rect): string {
      return `x=${rect.left.toFixed(1)}..${rect.right.toFixed(1)}, y=${rect.top.toFixed(1)}..${rect.bottom.toFixed(1)}`;
    }

    function childSizeSummary(element: Element): string {
      const parentStyle = getComputedStyle(element);
      const children = Array.from(element.children)
        .filter((child) => visible(child))
        .slice(0, 6)
        .map((child) => {
          const htmlChild = child as HTMLElement;
          const style = getComputedStyle(child);
          return `${describe(child)}=${htmlChild.clientWidth}x${htmlChild.clientHeight}`
            + `(scroll ${htmlChild.scrollWidth}x${htmlChild.scrollHeight}, width ${style.width}, max ${style.maxWidth})`;
        });
      const parent = `; box: width ${parentStyle.width}, padding ${parentStyle.paddingLeft}/${parentStyle.paddingRight}, box-sizing ${parentStyle.boxSizing}`;
      return children.length > 0 ? `${parent}; children: ${children.join(", ")}` : parent;
    }

    function addViolation(code: string, element: Element, detail: string): void {
      const key = `${code}:${describe(element)}:${detail}`;
      if (violationKeys.has(key)) return;
      violationKeys.add(key);
      violations.push({ code, detail, element: describe(element) });
    }

    function isWithin(inner: Rect, outer: Rect, tolerance: number): boolean {
      return inner.left >= outer.left - tolerance
        && inner.top >= outer.top - tolerance
        && inner.right <= outer.right + tolerance
        && inner.bottom <= outer.bottom + tolerance;
    }

    function scaleEnvelope(rect: Rect, scale: number): Rect {
      const width = rect.width * scale;
      const height = rect.height * scale;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return {
        bottom: centerY + height / 2,
        height,
        left: centerX - width / 2,
        right: centerX + width / 2,
        top: centerY - height / 2,
        width
      };
    }

    function directText(element: Element): string {
      return Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
    }

    function nearestBoundary(element: Element, root: Element): Element {
      const namedBoundary = element.getAttribute("data-display-contained-by");
      if (namedBoundary === "root") return root;
      if (namedBoundary) {
        return Array.from(root.querySelectorAll(containmentSelector)).find(
          (candidate) => candidate.getAttribute("data-display-containment") === namedBoundary
        ) ?? root;
      }
      return element.parentElement?.closest(containmentSelector) ?? root;
    }

    const candidates = Array.from(document.querySelectorAll<HTMLElement>(rootSelector))
      .filter((candidate) => candidate.closest(".display-preview-native") && visible(candidate));
    const root = candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
    })[0];
    if (!root) {
      throw new Error("Native player display has no visible [data-display-root] or .ml-display-shell");
    }

    const nativeHost = root.closest<HTMLElement>(".display-preview-native");
    if (!nativeHost) throw new Error("Player display root is not inside .display-preview-native");
    const previousCaptureState = nativeHost.getAttribute("data-native-capture");
    nativeHost.setAttribute("data-native-capture", "true");
    try {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

      const hostRect = rectOf(nativeHost);
      const rootRect = rectOf(root);
      const displayScale = nativeHost.clientWidth > 0 ? hostRect.width / nativeHost.clientWidth : 1;
      const rectTolerance = Math.max(0.75, displayScale * 1.5);
      const scrollTolerance = 1;

      if (!isWithin(rootRect, hostRect, rectTolerance)) {
        addViolation(
          "display-root-out-of-bounds",
          root,
          `root ${formatRect(rootRect)} is outside native display ${formatRect(hostRect)}`
        );
      }
      if (Math.abs(root.clientWidth - nativeHost.clientWidth) > scrollTolerance
        || Math.abs(root.clientHeight - nativeHost.clientHeight) > scrollTolerance) {
        addViolation(
          "display-root-size",
          root,
          `root is ${root.clientWidth}x${root.clientHeight}; native display is ${nativeHost.clientWidth}x${nativeHost.clientHeight}`
        );
      }

      const allElements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
      for (const element of allElements) {
        if (!visible(element) || ignored(element)) continue;
        const style = getComputedStyle(element);
        const text = directText(element);
        const playerFacingText = element.closest('[aria-hidden="true"]') === null && text.length > 0;

        if (playerFacingText && /\p{L}/u.test(text) && style.whiteSpace === "nowrap"
          && element.closest("[data-display-text='allow-nowrap']") === null) {
          addViolation(
            "player-text-nowrap",
            element,
            `player-facing text ${JSON.stringify(text.slice(0, 80))} uses white-space: nowrap`
          );
        }
        if (playerFacingText && style.textOverflow === "ellipsis") {
          addViolation(
            "player-text-ellipsis",
            element,
            `player-facing text ${JSON.stringify(text.slice(0, 80))} uses text-overflow: ellipsis`
          );
        }

        if (!allowsOverflow(element)) {
          const clipsX = ["auto", "clip", "hidden", "scroll"].includes(style.overflowX);
          const clipsY = ["auto", "clip", "hidden", "scroll"].includes(style.overflowY);
          const excessWidth = element.scrollWidth - element.clientWidth;
          const excessHeight = element.scrollHeight - element.clientHeight;
          if (clipsX && excessWidth > scrollTolerance) {
            addViolation(
              "clipped-horizontal-overflow",
              element,
              `scrollWidth exceeds clientWidth by ${excessWidth}px (${element.scrollWidth} > ${element.clientWidth})${childSizeSummary(element)}`
            );
          }
          if (clipsY && excessHeight > scrollTolerance) {
            addViolation(
              "clipped-vertical-overflow",
              element,
              `scrollHeight exceeds clientHeight by ${excessHeight}px (${element.scrollHeight} > ${element.clientHeight})${childSizeSummary(element)}`
            );
          }
        }
      }

      const geometryElements = new Set<Element>(root.querySelectorAll(markedSelector));
      for (const element of allElements) {
        if (directText(element).length > 0 && element.closest('[aria-hidden="true"]') === null) {
          geometryElements.add(element);
        }
      }
      for (const element of geometryElements) {
        const envelopeValue = element.getAttribute("data-display-scale-envelope");
        const envelopeScale = envelopeValue === null ? 1 : Number(envelopeValue);
        if (!visible(element) || ignored(element) || (allowsOverflow(element) && envelopeValue === null)) continue;
        if (!Number.isFinite(envelopeScale) || envelopeScale < 1) {
          addViolation(
            "invalid-scale-envelope",
            element,
            `data-display-scale-envelope must be a finite number greater than or equal to 1; received ${JSON.stringify(envelopeValue)}`
          );
          continue;
        }
        const boundary = nearestBoundary(element, root);
        const namedBoundary = element.getAttribute("data-display-contained-by");
        if (namedBoundary && namedBoundary !== "root" && boundary === root) {
          addViolation(
            "missing-containment-boundary",
            element,
            `data-display-contained-by=${JSON.stringify(namedBoundary)} has no matching data-display-containment target`
          );
          continue;
        }
        if (!visible(boundary) || ignored(boundary)) continue;
        const elementRect = scaleEnvelope(rectOf(element), envelopeScale);
        const boundaryRect = rectOf(boundary);
        if (!isWithin(elementRect, boundaryRect, rectTolerance)) {
          addViolation(
            "element-out-of-bounds",
            element,
            `${formatRect(elementRect)} is outside ${describe(boundary)} ${formatRect(boundaryRect)}`
          );
        }
      }

      const meters = Array.from(root.querySelectorAll<HTMLElement>(meterSelector))
        .filter((meter) => visible(meter) && !ignored(meter));
      const state = (window as PlaygroundWindow).ml?.getState();
      const lives = state?.snapshot.lives;
      const maxLives = state?.snapshot.maxLives;
      if (typeof lives === "number" && lives >= 0 && meters.length === 0) {
        addViolation(
          "missing-lives-meter",
          root,
          `snapshot exposes ${lives} lives but the display has no [data-lives-meter] or .ml-lives-meter`
        );
      }
      if (lives === -1 && meters.length > 0) {
        addViolation(
          "unexpected-lives-meter",
          meters[0]!,
          "snapshot uses lives: -1 but the display renders a lives meter"
        );
      }

      let slotCount = 0;
      for (const meter of meters) {
        const meterRect = rectOf(meter);
        const card = meter.parentElement?.closest<HTMLElement>(`${containmentSelector}, .ml-metric, article`) ?? root;
        const cardRect = rectOf(card);
        const slots = Array.from(meter.querySelectorAll<HTMLElement>(slotSelector))
          .filter((slot) => visible(slot) && !ignored(slot));
        slotCount += slots.length;
        const lifeMode = meter.dataset.lifeMode;
        if (lifeMode === "compact") {
          const compactTotal = Number(meter.dataset.lifeTotal);
          if (meter.querySelector("[data-life-summary]") === null) {
            addViolation(
              "missing-lives-summary",
              meter,
              "compact lives mode must render a deliberate [data-life-summary] count"
            );
          }
          if (slots.length > 0) {
            addViolation(
              "compact-lives-slots",
              meter,
              `compact lives mode must not render heart slots; found ${slots.length}`
            );
          }
          if (!Number.isInteger(compactTotal) || compactTotal < 1) {
            addViolation(
              "invalid-compact-lives-total",
              meter,
              `compact lives mode requires a positive integer data-life-total; received ${JSON.stringify(meter.dataset.lifeTotal)}`
            );
          }
        }
        if (lifeMode !== "compact" && typeof maxLives === "number" && slots.length !== maxLives) {
          addViolation(
            "lives-slot-count",
            meter,
            `rendered ${slots.length} heart slots for snapshot.maxLives=${maxLives}`
          );
        }
        if (!isWithin(meterRect, cardRect, rectTolerance)) {
          addViolation(
            "lives-meter-out-of-card",
            meter,
            `${formatRect(meterRect)} is outside ${describe(card)} ${formatRect(cardRect)}`
          );
        }
        for (const slot of slots) {
          const slotRect = rectOf(slot);
          if (!isWithin(slotRect, meterRect, rectTolerance)) {
            addViolation(
              "life-slot-out-of-meter",
              slot,
              `${formatRect(slotRect)} is outside meter ${formatRect(meterRect)}`
            );
          }
          if (!isWithin(slotRect, cardRect, rectTolerance)) {
            addViolation(
              "life-slot-out-of-card",
              slot,
              `${formatRect(slotRect)} is outside ${describe(card)} ${formatRect(cardRect)}`
            );
          }
          const visibleHeartParts = Array.from(slot.querySelectorAll<HTMLElement>(
            "[data-life-glyph], .ml-life-heart-glyph, .ml-life-heart-visual, svg"
          )).filter((part) => visible(part) && !ignored(part));
          for (const part of visibleHeartParts) {
            const envelopeValue = part.getAttribute("data-display-scale-envelope");
            const envelopeScale = envelopeValue === null ? 1 : Number(envelopeValue);
            if (!Number.isFinite(envelopeScale) || envelopeScale < 1) {
              addViolation(
                "invalid-scale-envelope",
                part,
                `data-display-scale-envelope must be a finite number greater than or equal to 1; received ${JSON.stringify(envelopeValue)}`
              );
              continue;
            }
            const partRect = scaleEnvelope(rectOf(part), envelopeScale);
            if (!isWithin(partRect, slotRect, rectTolerance)
              || !isWithin(partRect, meterRect, rectTolerance)
              || !isWithin(partRect, cardRect, rectTolerance)) {
              addViolation(
                envelopeScale > 1 ? "life-heart-envelope-out-of-bounds" : "life-heart-out-of-bounds",
                part,
                `${formatRect(partRect)} must stay inside slot ${formatRect(slotRect)}, meter ${formatRect(meterRect)}, and card ${formatRect(cardRect)}`
              );
            }
          }
        }
      }

      return {
        display: { height: root.clientHeight, width: root.clientWidth },
        maxLives,
        meters: meters.length,
        phase: state?.snapshot.phase,
        slots: slotCount,
        violations
      };
    } finally {
      if (previousCaptureState === null) nativeHost.removeAttribute("data-native-capture");
      else nativeHost.setAttribute("data-native-capture", previousCaptureState);
    }
  });

  assert.equal(
    report.violations.length,
    0,
    `${captureName} player-display geometry failed:\n${report.violations
      .map((violation) => `- [${violation.code}] ${violation.element}: ${violation.detail}`)
      .join("\n")}`
  );
  return report;
}
