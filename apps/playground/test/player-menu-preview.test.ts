import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localPlayerMenuUrl, readPrimaryScreen } from "../src/playerMenuEmbed.ts";

const previewSource = readFileSync(new URL("../src/PlayerMenuPreview.tsx", import.meta.url), "utf8");

test("local player menu preview targets the fixed kiosk viewport", () => {
  const target = localPlayerMenuUrl({
    hostname: "127.0.0.1",
    port: "5174",
    protocol: "http:",
  } as Location, "4103");

  const url = new URL(target!);
  assert.equal(url.origin, "http://127.0.0.1:4103");
  assert.equal(url.searchParams.get("embed"), "playground");
  assert.equal(url.searchParams.get("kioskViewport"), "1920x1080");
  assert.equal(url.searchParams.get("playgroundPort"), "5174");
});

test("player menu preview stays loopback-only", () => {
  assert.equal(localPlayerMenuUrl({
    hostname: "venue.example.com",
    port: "443",
    protocol: "https:",
  } as Location, "4103"), undefined);
});

test("screen query restores the selected playground preview", () => {
  assert.equal(readPrimaryScreen("?screen=menu"), "menu");
  assert.equal(readPrimaryScreen("?screen=display"), "display");
  assert.equal(readPrimaryScreen("?screen=unknown"), "display");
});

test("embedded menu permits only user-activated top navigation", () => {
  assert.match(previewSource, /title="Player menu"/u);
  const sandbox = previewSource.match(/sandbox="([^"]+)"/u)?.[1];
  assert.ok(sandbox);
  const permissions = sandbox.split(/\s+/u);
  assert.ok(permissions.includes("allow-top-navigation-by-user-activation"));
  assert.equal(permissions.includes("allow-top-navigation"), false);
});
