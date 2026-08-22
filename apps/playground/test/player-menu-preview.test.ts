import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localPlayerMenuUrl, readPrimaryScreen } from "../src/playerMenuEmbed.ts";

const previewSource = readFileSync(new URL("../src/PlayerMenuPreview.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const rootPackage = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

const loopbackPlayground = {
  href: "http://127.0.0.1:4104/",
  hostname: "127.0.0.1",
  origin: "http://127.0.0.1:4104",
  port: "4104",
  protocol: "http:",
} as Location;

test("the full local experience serves the menu from the playground origin", () => {
  const target = localPlayerMenuUrl(loopbackPlayground, {
    basePath: "/",
    enabled: true,
    loopbackOnly: true,
  });

  const url = new URL(target!);
  assert.equal(url.origin, "http://127.0.0.1:4104");
  assert.equal(url.pathname, "/player-menu/");
  assert.equal(url.searchParams.get("embed"), "playground");
  assert.equal(url.searchParams.get("kioskViewport"), "1920x1080");
});

test("the root development command starts the production-shaped venue environment", () => {
  assert.match(rootPackage.scripts.dev, /scripts\/dev-venue\.ts --mock-controller/u);
  assert.match(rootPackage.scripts["dev:standalone"], /@motion-levels-games\/playground/u);
  assert.match(rootPackage.scripts["dev:standalone"], /--port 4104/u);
  assert.equal(rootPackage.scripts["dev:venue:no-controller"], "npm run dev");
  assert.match(rootPackage.scripts["dev:game"], /scripts\/dev-game\.ts/u);
});

test("standalone authoring does not mount a disconnected venue menu", () => {
  assert.equal(localPlayerMenuUrl(loopbackPlayground, {
    basePath: "/",
    enabled: false,
    loopbackOnly: true,
  }), undefined);
});

test("player menu preview stays loopback-only", () => {
  assert.equal(localPlayerMenuUrl({
    hostname: "venue.example.com",
    href: "https://venue.example.com/",
    origin: "https://venue.example.com",
    port: "443",
    protocol: "https:",
  } as Location, {
    basePath: "/",
    enabled: true,
    loopbackOnly: true,
  }), undefined);
});

test("the hosted experience keeps its menu under the platform route", () => {
  const target = localPlayerMenuUrl({
    hostname: "platform.motionlevels.obis.dev",
    href: "https://platform.motionlevels.obis.dev/games/play/",
    origin: "https://platform.motionlevels.obis.dev",
    port: "443",
    protocol: "https:",
  } as Location, {
    basePath: "/games/play/",
    enabled: true,
    loopbackOnly: false,
  });

  const url = new URL(target!);
  assert.equal(url.origin, "https://platform.motionlevels.obis.dev");
  assert.equal(url.pathname, "/games/play/player-menu/");
});

test("screen query restores the selected playground preview", () => {
  assert.equal(readPrimaryScreen("?screen=menu"), "menu");
  assert.equal(readPrimaryScreen("?screen=display"), "display");
  assert.equal(readPrimaryScreen("?screen=unknown"), "display");
});

test("the menu iframe stays mounted while the primary screen changes", () => {
  assert.match(appSource, /<PlayerMenuPreview active=\{primaryScreen === "menu"\} src=\{playerMenuPreviewUrl\} \/>/u);
  assert.match(previewSource, /data-active=\{active\}/u);
  assert.match(styleSource, /\.player-menu-preview-native\.is-background\s*\{[\s\S]*?visibility:\s*hidden;/u);
});

test("embedded menu does not define a private launch handoff", () => {
  assert.doesNotMatch(previewSource, /postMessage|motion-levels:playground-launch/u);
});

test("embedded menu permits only user-activated top navigation", () => {
  assert.match(previewSource, /title="Player menu"/u);
  const sandbox = previewSource.match(/sandbox="([^"]+)"/u)?.[1];
  assert.ok(sandbox);
  const permissions = sandbox.split(/\s+/u);
  assert.ok(permissions.includes("allow-top-navigation-by-user-activation"));
  assert.equal(permissions.includes("allow-top-navigation"), false);
});
