import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const gameConfigControlSource = readFileSync(new URL("../src/GameConfigControl.tsx", import.meta.url), "utf8");
const phaseIndicatorSource = readFileSync(new URL("../src/PhaseIndicator.tsx", import.meta.url), "utf8");
const playgroundSelectSource = readFileSync(new URL("../src/PlaygroundSelect.tsx", import.meta.url), "utf8");
const statusDockSource = readFileSync(new URL("../src/PlaygroundStatusDock.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("all runtime phase surfaces share one indicator and color map", () => {
  const phaseIndicatorUses = [appSource, statusDockSource]
    .flatMap((source) => source.match(/<PhaseIndicator\b/g) ?? []);
  assert.equal(phaseIndicatorUses.length, 2, "header and Runtime card must both use PhaseIndicator");
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

test("the header phase label reserves a fixed slot so controls cannot move", () => {
  assert.match(
    styleSource,
    /--pg-phase-chip-width:\s*96px;/,
    "the phase slot must have one canonical width"
  );
  assert.match(
    styleSource,
    /\.phase-chip\s*\{[\s\S]*?flex:\s*0 0 var\(--pg-phase-chip-width\);[\s\S]*?inline-size:\s*var\(--pg-phase-chip-width\);[\s\S]*?justify-content:\s*flex-start;[\s\S]*?overflow:\s*hidden;[\s\S]*?white-space:\s*nowrap;/,
    "phase text must stay inside a non-growing header slot"
  );
  assert.match(
    appSource,
    /<PhaseIndicator className="phase-chip" phase=\{displayedPhase\} \/>/,
    "the header must use the fixed phase slot"
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

test("dialogs and selectors use composable pause locks", () => {
  assert.match(appSource, /const localPaused = isPlaygroundPaused\(manuallyPaused, pauseLocks\)/);
  assert.match(appSource, /setInteractionPauseState\("debug-dialog", open\)/);
  assert.match(appSource, /setInteractionPauseState\("settings-dialog", open\)/);
  assert.match(appSource, /setInteractionPauseState\("player-menu", nextScreen === "menu"\)/);

  for (const selector of ["game-select", "players-select", "difficulty-select"]) {
    assert.match(
      appSource,
      new RegExp(`lockId="${selector}"`),
      `${selector} must use its own shared selector lock`
    );
  }

  assert.match(playgroundSelectSource, /onBlur=\{\(\) => setOpen\(false\)\}/);
  assert.match(playgroundSelectSource, /onFocus=\{\(\) => setOpen\(true\)\}/);
  assert.match(playgroundSelectSource, /onPointerDown=\{\(\) => setOpen\(true\)\}/);
  assert.match(playgroundSelectSource, /if \(event\.key === "Escape"\) \{\s*setOpen\(false\);/);

  assert.match(appSource, /disabled=\{pauseLocks\.size > 0\}/, "temporary pause must not expose a misleading resume action");
});

test("effective pause blocks every player input path", () => {
  assert.match(
    appSource,
    /const handleTilePress[\s\S]*?if \(pausedRef\.current\) \{\s*return;\s*\}[\s\S]*?sessionRef\.current\.press/,
    "floor and API presses must stop before reaching the runtime session"
  );
  assert.match(
    appSource,
    /const handleTileRelease[\s\S]*?if \(pausedRef\.current\) \{\s*return;\s*\}[\s\S]*?sessionRef\.current\.release/,
    "floor and API releases must stop before reaching the runtime session"
  );
  assert.match(
    appSource,
    /tap: \(x, y, options\) => \{\s*if \(pausedRef\.current\) \{\s*return;\s*\}/,
    "tap must not smuggle a press or deterministic step through pause"
  );
  assert.match(appSource, /interactive=\{!paused\}/, "paused floor tiles must not remain interactive controls");
  assert.match(
    appSource,
    /<FloorPreview[\s\S]*?interactive=\{!paused\}[\s\S]*?inputMode="momentary"/,
    "the playground floor must release pointer input like the controller preview"
  );
  assert.match(
    appSource,
    /if \(!pausedRef\.current && nextEffectivePaused\) \{\s*releaseActivePlayerInputs\(\);\s*\}/,
    "entering pause must release inputs that were already held"
  );
  assert.match(
    appSource,
    /<PlayerDisplayRuntimeProvider paused=\{paused\} floorRotationDegrees=\{floorRotationDegrees\}>[\s\S]*?<PlayerDisplay snapshot=\{displaySnapshot\} frame=\{displayFrame\} \/>/,
    "the shared runtime provider must always carry effective pause into every TV display"
  );
});

test("every playground configuration change restarts the active game", () => {
  assert.match(appSource, /const changeSeed[\s\S]*?restart\(nextSeed\)/);
  assert.match(appSource, /const changePlayerCount[\s\S]*?restart\(seedRef\.current, nextPlayerCount\)/);
  assert.match(appSource, /const changeDifficulty[\s\S]*?restart\([\s\S]*?nextDifficulty\)/);
  assert.match(appSource, /const setGameOptionState[\s\S]*?restart\([\s\S]*?nextOptions/);
  assert.match(appSource, /storeSelectedGameId\(nextGame\.manifest\.id\)/);
});

test("integrated player journey owns player-facing game selection", () => {
  assert.match(
    appSource,
    /\{!playerMenuPreviewUrl \? \([\s\S]*?className="control-group control-group-primary"[\s\S]*?label="Game"[\s\S]*?label="Players"[\s\S]*?label="Difficulty"[\s\S]*?\) : null\}/,
    "integrated mode must not duplicate the menu's game, roster, or difficulty selection"
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

test("header selectors keep stable field widths across selected values", () => {
  const expectedWidths = {
    game: "176px",
    players: "82px",
    difficulty: "104px",
    seed: "72px"
  };

  for (const [field, width] of Object.entries(expectedWidths)) {
    assert.match(
      styleSource,
      new RegExp(`\\.control-${field}\\s*\\{[^}]*width:\\s*${width};`, "s"),
      `${field} must reserve a stable width`
    );
  }

  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*?\.playground-controls label\s*\{[^}]*width:\s*100%;/s,
    "narrow layouts must still let fields fill their responsive grid cells"
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
    /@media \(max-width: 760px\)[\s\S]*?grid-template-areas:[\s\S]*?"title title title title"[\s\S]*?"game players difficulty seed"[\s\S]*?"game-actions surface-actions surface-actions surface-actions"/,
    "narrow headers must use the intentional compact three-row layout"
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*?\.playground-controls\s*\{[^}]*display:\s*contents;/,
    "narrow controls must participate in the header grid"
  );
  assert.match(
    styleSource,
    /@container display-panel \(max-width: 660px\) and \(max-height: 650px\)[\s\S]*?height:\s*min\(100cqh, calc\(100cqw \* 9 \/ 16\)\)/,
    "short narrow previews must fit their panel now that the header owns a separate row"
  );
});

test("the standard top bar owns surface selection at every layout", () => {
  assert.match(
    appSource,
    /<header className="playground-header">[\s\S]*?className="surface-mode-toggle"[\s\S]*?<\/header>[\s\S]*?<section className="playground-grid">/,
    "surface selection must stay in the shared header instead of either stage panel"
  );
  assert.match(
    appSource,
    /aria-pressed=\{agentLabActive\}[\s\S]*?disabled=\{selectedGame\.createSessionController === undefined\}/,
    "Agents 3D must remain visible and disabled when a game has no product controller"
  );
  assert.match(
    appSource,
    /aria-label="Primary screen"[\s\S]*?> Display[\s\S]*?> Menu/,
    "the primary stage must offer an explicit player display / menu toggle"
  );
  assert.match(
    styleSource,
    /@media \(orientation: portrait\) and \(max-width: 1200px\)[\s\S]*?\.status-dock\s*\{[^}]*grid-column:\s*1 \/ -1;/,
    "portrait diagnostics must span the workbench instead of overloading one narrow column"
  );
  assert.match(
    styleSource,
    /@media \(orientation: landscape\) and \(min-width: 1201px\)[\s\S]*?\.floor-panel\s*\{[^}]*grid-row:\s*1 \/ -1;/,
    "wide landscape must preserve the physical floor's full viewport height"
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*?\.floor-panel,[\s\S]*?grid-row:\s*1;[\s\S]*?\.display-preview-box,[\s\S]*?grid-row:\s*2;[\s\S]*?\.status-dock,[\s\S]*?grid-row:\s*3;/,
    "narrow layouts must keep the floor, display, and diagnostics in an explicit non-overlapping order"
  );
  assert.match(
    styleSource,
    /\.floor-panel:not\(\.is-agent-lab\)\s*\{[^}]*height:\s*min\(calc\(\(100vw - \(2 \* var\(--stage-pad\)\)\) \* 2\), 720px\);/,
    "the narrow physical-floor grid row must reserve its rendered 16x32 height"
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
    assert.match(statusDockSource, new RegExp(`className="${section}"`), `${section} must remain available`);
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

test("event stream remains scrollable without disturbing the dock layout", () => {
  assert.match(
    styleSource,
    /\.status-event-history\s*\{[^}]*display:\s*grid;[^}]*overflow-y:\s*auto;/s,
    "event history must remain visible and scroll within its card"
  );
  assert.match(
    styleSource,
    /\.status-event-history\s*\{[^}]*margin:\s*8px 0 0;[^}]*padding:\s*0;/s,
    "event rows and the auto-follow button must share the same right edge"
  );
});

test("numeric settings use app-format decimals and documented help", () => {
  assert.match(gameConfigControlSource, /className="setting-number-input"[\s\S]*?type="text"/);
  assert.doesNotMatch(gameConfigControlSource, /type="number"/, "native localized number inputs are not allowed");
  assert.match(gameConfigControlSource, /replaceAll\(",", "\."\)/, "typed decimal commas must normalize to periods");
  assert.match(gameConfigControlSource, /function ConfigVarLabel/);
  assert.match(gameConfigControlSource, /className="setting-tooltip"[^>]*role="tooltip"/);
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
