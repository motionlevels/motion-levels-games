import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const phaseIndicatorSource = readFileSync(new URL("../src/PhaseIndicator.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("all runtime phase surfaces share one indicator and color map", () => {
  assert.equal(
    appSource.match(/<PhaseIndicator\b/g)?.length,
    2,
    "header and Runtime card must both use PhaseIndicator"
  );
  assert.match(
    phaseIndicatorSource,
    /className=\{`phase-indicator \$\{className\}`\.trim\(\)\} data-phase=\{phase\}/,
    "the shared component must own the phase marker contract"
  );
  assert.match(
    styleSource,
    /--pg-phase-standby:\s*var\(--pg-accent\);/,
    "Standby must use the shared blue accent token"
  );
  assert.match(
    styleSource,
    /\.phase-indicator\s*\{[^}]*--phase-indicator-color:\s*var\(--pg-phase-standby\);/s,
    "the shared phase indicator must default to Standby blue"
  );
  assert.doesNotMatch(
    styleSource,
    /\.(?:phase-chip|runtime-state)(?:\.is-paused)? i\s*\{/,
    "component-specific phase dot colors are forbidden"
  );
});

test("every playground dialog uses the shared icon close control", () => {
  const dialogs = appSource.match(/role="dialog"/g) ?? [];
  const sharedCloseControls = appSource.match(/<PopoverCloseButton\b/g) ?? [];

  assert.ok(dialogs.length > 0, "expected the playground to contain at least one dialog");
  assert.equal(
    sharedCloseControls.length,
    dialogs.length,
    "each dialog must use exactly one PopoverCloseButton"
  );
  assert.match(appSource, /function PopoverCloseButton[\s\S]*?<X\b/, "shared close control must remain icon-based");
  assert.doesNotMatch(
    appSource,
    /aria-label="Close[^"]*"[^>]*>\s*Close\s*</s,
    "text-based dialog close buttons are not allowed"
  );
});

test("compact action groups use zero-gap shared control styling", () => {
  assert.match(styleSource, /--pg-control-bg:/, "shared control background token is required");
  assert.match(styleSource, /--pg-control-border:/, "shared control border token is required");
  assert.match(styleSource, /--pg-control-gap:/, "shared control spacing token is required");
  assert.match(
    styleSource,
    /\.playground-header\s*\{[^}]*gap:\s*8px var\(--pg-control-gap\);/s,
    "header action groups must use shared spacing"
  );
  assert.match(
    styleSource,
    /\.playground-controls\s*\{[^}]*gap:\s*var\(--pg-control-gap\);/s,
    "form and action boundaries must use shared spacing"
  );
  assert.match(styleSource, /\.control-actions\s*\{[^}]*gap:\s*0;/s, "game actions must not have gaps");
  assert.match(styleSource, /\.capture-actions\s*\{[^}]*gap:\s*0;/s, "capture actions must not have gaps");
  assert.doesNotMatch(
    styleSource,
    /\.control-actions\s*\{[^}]*border-left:/s,
    "game actions must not reintroduce a decorative divider"
  );
  assert.doesNotMatch(
    styleSource,
    /\.playground-controls \.fullscreen-button\s*\{/,
    "individual toolbar buttons must not introduce one-off colors"
  );
});

test("copy feedback uses an out-of-flow toast", () => {
  assert.doesNotMatch(appSource, /capture-status/, "copy feedback must not remain inside the toolbar");
  assert.match(appSource, /className=\{`capture-toast/, "copy feedback must use the shared toast");
  assert.match(styleSource, /\.capture-toast\s*\{[^}]*position:\s*fixed;/s, "copy feedback must not affect layout");
  assert.match(appSource, /aria-live="polite"/, "copy feedback must be announced accessibly");
});

test("narrow playground headers use an explicit responsive grid", () => {
  for (const field of ["game", "players", "difficulty", "seed"]) {
    assert.match(appSource, new RegExp(`control-field control-${field}`), `${field} needs a stable grid area`);
  }
  assert.match(
    styleSource,
    /@container display-panel \(max-width: 660px\)[\s\S]*?grid-template-areas:[\s\S]*?"title title"[\s\S]*?"game players"[\s\S]*?"difficulty seed"[\s\S]*?"game-actions surface-actions"/,
    "narrow headers must use the intentional four-row layout"
  );
  assert.match(
    styleSource,
    /@container display-panel \(max-width: 660px\)[\s\S]*?\.playground-controls\s*\{[^}]*display:\s*contents;/,
    "narrow controls must participate in the header grid"
  );
  assert.match(
    styleSource,
    /@container display-panel \(max-width: 660px\) and \(max-height: 650px\)[\s\S]*?height:\s*min\([\s\S]*?100cqh - var\(--pg-narrow-header-height\)[\s\S]*?100cqw \* 9 \/ 16/,
    "short narrow previews must fit both the remaining height and their true aspect-ratio width"
  );
});

test("playground surfaces preserve their hardware aspect ratios", () => {
  assert.match(
    styleSource,
    /\.display-preview-box\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9;[^}]*height:\s*auto;/s,
    "the player display must derive height from its 16:9 width"
  );
  assert.match(
    styleSource,
    /\.floor-panel \.ml-floor-preview\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*32;[^}]*height:\s*auto;[^}]*width:\s*min\(/s,
    "the floor must derive height from one constrained 16:32 dimension"
  );
  assert.doesNotMatch(
    styleSource,
    /\.floor-panel \.ml-floor-preview\s*\{[^}]*height:\s*calc\(/s,
    "the floor must never receive independent calculated width and height"
  );
});

test("tall status docks expose useful adaptive diagnostics", () => {
  for (const section of ["status-runtime-summary", "status-event-history", "status-run-summary"]) {
    assert.match(appSource, new RegExp(`className="${section}"`), `${section} must remain available`);
  }
  assert.match(
    styleSource,
    /\.status-dock\s*\{[^}]*container-name:\s*status-dock;[^}]*container-type:\s*size;/s,
    "the status dock must be independently responsive"
  );
  assert.match(
    styleSource,
    /@container status-dock \(min-width: 761px\) and \(min-height: 220px\)[\s\S]*?\.status-runtime-summary\s*\{[^}]*display:\s*grid;/,
    "expanded diagnostics must activate only when useful space exists"
  );
});

test("event stream stays visible, timestamped, and follows the latest event", () => {
  assert.match(
    appSource,
    /className="status-event-history"[\s\S]*?aria-live="polite"[\s\S]*?ref=\{eventStreamRef\}/,
    "the event stream must announce and follow live additions"
  );
  assert.match(
    appSource,
    /eventStream\.map[\s\S]*?<time[\s\S]*?formatElapsedClock\(event\.atMillis\)/,
    "every event row needs the shared elapsed-time clock"
  );
  assert.match(
    appSource,
    /aria-pressed=\{eventAutoFollow\}[\s\S]*?setEventAutoFollowState\(!eventAutoFollowRef\.current\)/,
    "auto-follow needs an accessible icon toggle"
  );
  assert.match(
    appSource,
    /const isAtLatest = stream\.scrollTop <= 1;[\s\S]*?setEventAutoFollowState\(isAtLatest\)/,
    "scrolling away must pause follow and returning to the top must resume it"
  );
  assert.doesNotMatch(
    appSource,
    /const eventStream = \[\.\.\.events\]\.reverse\(\)/,
    "the newest event must stay at the top"
  );
  assert.match(
    styleSource,
    /\.status-event-history\s*\{[^}]*display:\s*grid;[^}]*overflow-y:\s*auto;/s,
    "event history must remain visible and scroll within its card"
  );
});

test("numeric settings use app-format decimals and documented help", () => {
  assert.match(appSource, /className="setting-number-input"[\s\S]*?type="text"/);
  assert.doesNotMatch(appSource, /type="number"/, "native localized number inputs are not allowed");
  assert.match(appSource, /replaceAll\(",", "\."\)/, "typed decimal commas must normalize to periods");
  assert.match(appSource, /function ConfigVarLabel/);
  assert.match(appSource, /className="setting-tooltip"[^>]*role="tooltip"/);
  assert.match(styleSource, /\.setting-info:hover \.setting-tooltip,[\s\S]*?\.setting-info:focus-visible \.setting-tooltip/);
});

test("settings actions stay in the header and scrolling is viewport-driven", () => {
  assert.match(
    appSource,
    /className="settings-popover-actions"[\s\S]*?className="settings-reset"[\s\S]*?<PopoverCloseButton/,
    "reset must appear immediately before the shared close action"
  );
  assert.doesNotMatch(appSource, /settings-footer/, "settings must not reserve a footer for reset");
  assert.match(
    styleSource,
    /\.settings-popover\s*\{[^}]*max-height:\s*calc\(100dvh - 100% - \(3 \* var\(--stage-pad\)\)\);[^}]*overflow-y:\s*auto;/s,
    "settings may scroll only when constrained by the viewport"
  );
  assert.doesNotMatch(
    styleSource,
    /\.settings-popover\s*\{[^}]*max-height:\s*min\(460px,/s,
    "settings must not use an arbitrary fixed scroll cap"
  );
});

test("active run settings reserve space for descriptive labels", () => {
  assert.match(
    styleSource,
    /\.status-config-list\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s,
    "expanded active-run settings need three readable columns"
  );
  assert.match(
    styleSource,
    /\.status-config-list > div\s*\{[^}]*grid-template-rows:\s*minmax\(2\.3em, 1fr\) auto;/s,
    "values must align below a stable descriptive-label area"
  );
  assert.match(
    styleSource,
    /@container status-dock \(max-height: 219px\)[\s\S]*?\.status-config-list\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/s,
    "compact docks must retain their dense four-column fallback"
  );
});
