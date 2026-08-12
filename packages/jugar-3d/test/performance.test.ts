import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  JugarStagePerformanceMonitor,
  bytesToMegabytes,
  estimateJugarStageMemoryProxy,
  jugarStageQualityBudgets,
  type JugarStagePerformanceSample
} from "../src/performance.ts";

test("quality tiers expose explicit complete-scene budgets", () => {
  assert.deepEqual(Object.keys(jugarStageQualityBudgets).sort(), [
    "capture",
    "desktop-medium",
    "mobile-low",
    "venue-high"
  ]);
  assert.deepEqual(jugarStageQualityBudgets["desktop-medium"], {
    minimumSamples: 60,
    maxP95FrameMillis: 25,
    maxSoftwareP95FrameMillis: 700,
    maxDrawCalls: 170,
    maxTriangles: 33_000,
    maxGeometries: 168,
    maxTextures: 4,
    maxPrograms: 9,
    maxGpuMemoryProxyMegabytes: 24
  });
  assert.ok(
    jugarStageQualityBudgets["mobile-low"].maxGpuMemoryProxyMegabytes
      < jugarStageQualityBudgets.capture.maxGpuMemoryProxyMegabytes
  );
  assert.ok(
    jugarStageQualityBudgets.capture.maxP95FrameMillis
      > jugarStageQualityBudgets["venue-high"].maxP95FrameMillis
  );
  assert.equal(jugarStageQualityBudgets["mobile-low"].maxSoftwareP95FrameMillis, 175);
  assert.equal(jugarStageQualityBudgets["venue-high"].maxSoftwareP95FrameMillis, 175);
  assert.equal(jugarStageQualityBudgets.capture.maxSoftwareP95FrameMillis, 1400);
  assert.equal(jugarStageQualityBudgets.capture.maxP95FrameMillis, 40);
  assert.equal(jugarStageQualityBudgets.capture.maxDrawCalls, 170);
});

test("the performance monitor is bounded and evaluates every structural channel", () => {
  const monitor = new JugarStagePerformanceMonitor("mobile-low", 3);
  monitor.record(sample());
  monitor.record(sample({ frameMillis: 20 }));
  assert.equal(monitor.report().budgetReady, false);
  monitor.record(sample({ frameMillis: 30 }));
  monitor.record(sample({ frameMillis: 31 }));
  const bounded = monitor.report();
  assert.equal(bounded.samples, 3);
  assert.equal(bounded.worstFrameMillis, 31);

  const violating = new JugarStagePerformanceMonitor("mobile-low", 1);
  violating.record(sample({
    frameMillis: 35,
    drawCalls: 171,
    triangles: 33_001,
    geometries: 169,
    textures: 5,
    programs: 10,
    gpuMemoryProxyMegabytes: 21
  }));
  const report = violating.report();
  assert.deepEqual(report.violations, [
    "frame-time",
    "draw-calls",
    "triangles",
    "geometries",
    "textures",
    "programs",
    "gpu-memory-proxy"
  ]);
  assert.equal(report.structuralWithinBudget, false);
  assert.equal(report.timingWithinBudget, false);
  assert.equal(report.withinBudget, false);
  assert.throws(() => new JugarStagePerformanceMonitor("capture", 0), /positive integer/u);
  assert.throws(() => violating.record(sample({ drawCalls: Number.NaN })), /finite and non-negative/u);
});

test("venue and capture timing stay visible but are waived only for identified software WebGL", () => {
  const monitor = new JugarStagePerformanceMonitor("venue-high", 60);
  for (let index = 0; index < 60; index += 1) monitor.record(sample({ frameMillis: 200 }));
  const hardware = monitor.report({
    environment: { renderer: "Example GPU", vendor: "Example", softwareRenderer: false }
  });
  assert.deepEqual(hardware.violations, ["frame-time"]);
  assert.equal(hardware.timingBudgetWaived, false);
  assert.equal(hardware.withinBudget, false);

  const software = monitor.report({
    environment: { renderer: "ANGLE SwiftShader", vendor: "Google", softwareRenderer: true }
  });
  assert.deepEqual(software.violations, ["frame-time"]);
  assert.equal(software.structuralWithinBudget, true);
  assert.equal(software.softwareTimingWithinBudget, false);
  assert.equal(software.timingBudgetWaived, true);
  assert.equal(software.budgetReady, true);
  assert.equal(software.withinBudget, true);

  const capture = new JugarStagePerformanceMonitor("capture", 45);
  for (let index = 0; index < 45; index += 1) capture.record(sample({ frameMillis: 2_100 }));
  const captureSoftware = capture.report({
    environment: { renderer: "ANGLE SwiftShader", vendor: "Google", softwareRenderer: true }
  });
  assert.deepEqual(captureSoftware.violations, ["frame-time"]);
  assert.equal(captureSoftware.softwareTimingWithinBudget, false);
  assert.equal(captureSoftware.timingBudgetWaived, true);
  assert.equal(captureSoftware.withinBudget, true);
});

test("memory proxy deduplicates shared scene resources without WebGL", () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const texture = new THREE.DataTexture(new Uint8Array(2 * 2 * 4), 2, 2);
  texture.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const one = new THREE.Group();
  one.add(new THREE.Mesh(geometry, material));
  const shared = new THREE.Group();
  shared.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const options = { drawingBufferWidth: 10, drawingBufferHeight: 5, shadowMapSize: 4 };
  const oneProxy = estimateJugarStageMemoryProxy(one, options);
  const sharedProxy = estimateJugarStageMemoryProxy(shared, options);

  assert.equal(sharedProxy.geometryBytes, oneProxy.geometryBytes);
  assert.equal(sharedProxy.textureBytes, 16);
  assert.equal(sharedProxy.framebufferBytes, 400);
  assert.equal(sharedProxy.shadowBytes, 64);
  assert.equal(sharedProxy.totalBytes, oneProxy.totalBytes);
  assert.equal(bytesToMegabytes(1024 * 1024), 1);

  geometry.dispose();
  material.dispose();
  texture.dispose();
});

function sample(overrides: Partial<JugarStagePerformanceSample> = {}): JugarStagePerformanceSample {
  return {
    frameMillis: 16,
    drawCalls: 100,
    triangles: 30_000,
    geometries: 100,
    textures: 2,
    programs: 8,
    geometryMemoryProxyMegabytes: 1,
    textureMemoryProxyMegabytes: 1,
    framebufferMemoryProxyMegabytes: 8,
    shadowMemoryProxyMegabytes: 4,
    gpuMemoryProxyMegabytes: 14,
    ...overrides
  };
}
