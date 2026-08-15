import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const dialogSource = appSource.slice(appSource.indexOf("function OperatorSettingsDialog"));
const welcomeSource = appSource.slice(appSource.indexOf("function WelcomeScreen"), appSource.indexOf("function RecordingModePicker"));
const teamDrawerSource = appSource.slice(appSource.indexOf("panel team-panel team-drawer"), appSource.indexOf('className="main-panel"'));

describe("operator settings diagnostics", () => {
  it("keeps the diagnostic card visible on both sides of the operator lock", () => {
    const diagnostics = dialogSource.indexOf('className="settings-version-card"');
    const operatorBranch = dialogSource.indexOf("{unlocked ? (");

    assert.ok(diagnostics >= 0);
    assert.ok(operatorBranch > diagnostics, "diagnostics must render before the locked/unlocked branch");
  });

  it("keeps recording controls behind the operator PIN", () => {
    const operatorBranch = dialogSource.indexOf("{unlocked ? (");
    const recordingPicker = dialogSource.indexOf("<RecordingModePicker");

    assert.doesNotMatch(welcomeSource, /<RecordingModePicker/u);
    assert.doesNotMatch(teamDrawerSource, /<RecordingModePicker/u);
    assert.ok(recordingPicker > operatorBranch, "recording controls must render only in the unlocked operator branch");
  });

  it("uses the full settings dialog width for the locked operator layout", () => {
    assert.match(stylesSource, /\.settings-modal\s*\{[^}]*width: min\(1160px, 100%\)/su);
    assert.match(stylesSource, /\.pin-panel\s*\{[^}]*grid-template-areas:/su);
  });

  it("shows a compact revision while retaining the complete revision as its title", () => {
    assert.match(dialogSource, /<strong title=\{__MENU_BUILD_REVISION__\}>\{__MENU_BUILD_REVISION__\.slice\(0, 8\)\}<\/strong>/u);
    assert.doesNotMatch(dialogSource, /<strong>menu \{__MENU_BUILD_REVISION__\}<\/strong>/u);
  });

  it("exposes strict, accessible floor and audio output tests", () => {
    assert.match(dialogSource, /connectionState === "connection-on" && status\?\.pressureStreamConnected === true/u);
    assert.match(dialogSource, /const audioCanTest = connectionState === "connection-on" && audioConfigured && testModeAvailable/u);
    assert.doesNotMatch(dialogSource, /audioCanTest = audioControlAvailable/u);
    assert.match(dialogSource, /target="floor"[\s\S]*?target="audio"/u);
    assert.match(appSource, /const nextStatus = await testOutput\(target\);\s*acceptStatus\(nextStatus\);/u);
    assert.match(appSource, /aria-label=\{`\$\{name\}: \$\{label\}\. \$\{hint\}`\}/u);
    assert.match(appSource, /aria-busy=\{busy \|\| undefined\}/u);
    assert.match(appSource, /role=\{effectiveState === "failed" \? "alert" : undefined\}/u);
    assert.match(appSource, /disabled=\{!canTest \|\| busy \|\| blockedByOtherTest\}/u);
    assert.match(appSource, /const baselineOutputTestId = status\?\.outputTest\?\.id \?\? ""/u);
    assert.match(appSource, /status\.outputTest\.id === settingsTestError\.baselineOutputTestId/u);
    assert.doesNotMatch(appSource, /attemptedUnixMillis/u);
  });

  it("renders authoritative output-test progress with tactile feedback", () => {
    assert.match(dialogSource, /visibleOutputTest\?\.target === "floor" \? visibleOutputTest\.state : "idle"/u);
    assert.match(dialogSource, /visibleOutputTest\?\.target === "audio" \? visibleOutputTest\.state : "idle"/u);
    assert.match(dialogSource, /const visibleOutputTest = status\?\.outputTest \?\? null/u);
    assert.doesNotMatch(dialogSource, /Date\.now\(\).*finishedUnixMillis/u);
    assert.match(appSource, /state === "passed" && !currentHealthy \? "idle" : state/u);
    assert.match(stylesSource, /\.settings-test-action\.testing\s*\{[^}]*animation: settingsTestButtonPulse/su);
    assert.match(stylesSource, /\.settings-test-action:active:not\(:disabled\)/u);
    assert.match(stylesSource, /@keyframes settingsTestRipple/u);
  });
});
