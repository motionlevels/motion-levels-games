export const floorRotationDegrees = [0, 90, 180, 270] as const;

export type FloorRotationDegrees = typeof floorRotationDegrees[number];

export type FloorDisplaySize = {
  width: number;
  height: number;
};

export type FloorCoordinate = {
  x: number;
  y: number;
};

export function normalizeFloorRotationDegrees(value: unknown): FloorRotationDegrees {
  const numeric = typeof value === "string"
    ? Number(value.trim().replace(/^rotate-/u, ""))
    : value;
  return numeric === 90 || numeric === 180 || numeric === 270 ? numeric : 0;
}

export function composeFloorRotations(
  base: FloorRotationDegrees,
  additional: FloorRotationDegrees
): FloorRotationDegrees {
  return normalizeFloorRotationDegrees((base + additional) % 360);
}

export function floorDisplaySize(
  width: number,
  height: number,
  rotationDegrees: FloorRotationDegrees
): FloorDisplaySize {
  return rotationDegrees === 90 || rotationDegrees === 270
    ? { width: height, height: width }
    : { width, height };
}

export function floorToDisplayCoordinate(
  coordinate: FloorCoordinate,
  width: number,
  height: number,
  rotationDegrees: FloorRotationDegrees
): FloorCoordinate {
  if (rotationDegrees === 90) {
    return { x: height - 1 - coordinate.y, y: coordinate.x };
  }
  if (rotationDegrees === 180) {
    return { x: width - 1 - coordinate.x, y: height - 1 - coordinate.y };
  }
  if (rotationDegrees === 270) {
    return { x: coordinate.y, y: width - 1 - coordinate.x };
  }
  return coordinate;
}

export function displayToFloorCoordinate(
  coordinate: FloorCoordinate,
  width: number,
  height: number,
  rotationDegrees: FloorRotationDegrees
): FloorCoordinate {
  if (rotationDegrees === 90) {
    return { x: coordinate.y, y: height - 1 - coordinate.x };
  }
  if (rotationDegrees === 180) {
    return { x: width - 1 - coordinate.x, y: height - 1 - coordinate.y };
  }
  if (rotationDegrees === 270) {
    return { x: width - 1 - coordinate.y, y: coordinate.x };
  }
  return coordinate;
}
