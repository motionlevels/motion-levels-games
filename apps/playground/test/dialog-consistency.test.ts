import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const gameConfigControlSource = readFileSync(new URL("../src/GameConfigControl.tsx", import.meta.url), "utf8");
const phaseIndicatorSource = readFileSync(new URL("../src/PhaseIndicator.tsx", import.meta.url), "utf8");
const playgroundSelectSource = readFileSync(new URL("../src/PlaygroundSelect.tsx", import.meta.url), "utf8");
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

test("dialogs and selectors use composable pause locks", () => {
  assert.match(appSource, /const paused = isPlaygroundPaused\(manuallyPaused, pauseLocks\)/);
  assert.match(appSource, /setInteractionPauseState\("debug-dialog", open\)/);
  assert.match(appSource, /setInteractionPauseState\("settings-dialog", open\)/);

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
    /const handleTilePress[\s\S]*?if \(pausedRef\.current\) \{\s*return;\s*\}[\s\S]*?engineRef\.current\.press/,
    "floor and API presses must stop before reaching the engine"
  );
  assert.match(
    appSource,
    /const handleTileRelease[\s\S]*?if \(pausedRef\.current\) \{\s*return;\s*\}[\s\S]*?engineRef\.current\.release/,
    "floor and API releases must stop before reaching the engine"
  );
  assert.match(
    appSource,
    /tap: \(x, y, options\) => \{\s*if \(pausedRef\.current\) \{\s*return;\s*\}/,
    "tap must not smuggle a press or deterministic step through pause"
  );
  assert.match(appSource, /interactive=\{!paused\}/, "paused floor tiles must not remain interactive controls");
  assert.match(
    appSource,
    /if \(!pausedRef\.current && nextEffectivePaused\) \{\s*releaseActivePlayerInputs\(\);\s*\}/,
    "entering pause must release inputs that were already held"
  );
  assert.match(
    appSource,
    /<PlayerDisplayRuntimeProvider paused=\{paused\}>[\s\S]*?<PlayerDisplay snapshot=\{snapshot\} frame=\{frame\} \/>/,
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
    /@container display-panel \(max-width: 660px\)[\s\S]*?\.playground-controls label\s*\{[^}]*width:\s*100%;/s,
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

test("latched floor inputs never imitate the transient mouse hover", () => {
  const pressedRule = styleSource.match(/\.floor-panel \.ml-floor-tile-pressed\s*\{[^}]*\}/s)?.[0];
  assert.ok(pressedRule, "the floor needs an intentional occupied-tile treatment");
  assert.match(pressedRule, /inset 0 0 0 2px rgba\(53, 215, 255,/);
  assert.doesNotMatch(pressedRule, /outline|transform|#ffffff/, "persistent input must not reuse the white scaled hover effect");
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
