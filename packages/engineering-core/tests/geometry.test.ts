import { describe, expect, it } from 'vitest';
import {
  calculateBodyEnvelope,
  calculateRequiredInstallationEnvelope,
  isOrientationAllowed,
  transformLocalFace,
  validateOrientationConstraint,
  type ClearanceRequirementsMm,
  type OrientationTransform,
} from '../src/index.js';

const identity: OrientationTransform = {
  id: 'identity',
  x: { axis: 'world_x', direction: 1 },
  y: { axis: 'world_y', direction: 1 },
  z: { axis: 'world_z', direction: 1 },
};

const zToX: OrientationTransform = {
  id: 'local-z-to-world-x',
  x: { axis: 'world_z', direction: 1 },
  y: { axis: 'world_y', direction: 1 },
  z: { axis: 'world_x', direction: 1 },
};

const completeZeroClearance: ClearanceRequirementsMm = {
  service: { x_min: 0, x_max: 0, y_min: 0, y_max: 0, z_min: 0, z_max: 0 },
};

describe('mounting geometry', () => {
  it('preserves intrinsic dimensions for identity orientation', () => {
    expect(calculateBodyEnvelope({ x: 255, y: 125, z: 520 }, identity)).toMatchObject({
      ok: true,
      value: { world_x: 255, world_y: 125, world_z: 520 },
    });
  });

  it('remaps dimensions for distinct orthogonal orientations', () => {
    expect(calculateBodyEnvelope({ x: 255, y: 125, z: 520 }, zToX)).toMatchObject({
      ok: true,
      value: { world_x: 520, world_y: 125, world_z: 255 },
    });
  });

  it('rejects duplicate and missing world-axis mappings', () => {
    const duplicate = calculateBodyEnvelope(
      { x: 1, y: 2, z: 3 },
      {
        ...identity,
        z: { axis: 'world_x', direction: 1 },
      },
    );
    const missing = calculateBodyEnvelope(
      { x: 1, y: 2, z: 3 },
      {
        ...identity,
        y: undefined as never,
      },
    );
    expect(duplicate.status).toBe('invalid');
    expect(missing.status).toBe('invalid');
  });

  it('rejects negative dimensions and keeps zero dimensions invalid', () => {
    expect(calculateBodyEnvelope({ x: -1, y: 2, z: 3 }, identity).status).toBe('invalid');
    expect(calculateBodyEnvelope({ x: 0, y: 2, z: 3 }, identity).status).toBe('invalid');
  });

  it('keeps local mounting faces local while transforming their world side', () => {
    expect(transformLocalFace('z_min', zToX)).toBe('world_x_min');
    expect(transformLocalFace('x_max', zToX)).toBe('world_z_max');
  });

  it('swaps local face sides for a negative signed-axis mapping', () => {
    const negative: OrientationTransform = {
      ...identity,
      x: { axis: 'world_z', direction: -1 },
      z: { axis: 'world_x', direction: 1 },
    };
    expect(transformLocalFace('x_min', negative)).toBe('world_z_max');
    expect(transformLocalFace('x_max', negative)).toBe('world_z_min');
  });

  it('preserves asymmetric clearance sides through a negative signed orientation', () => {
    const negative: OrientationTransform = {
      ...identity,
      x: { axis: 'world_z', direction: -1 },
      z: { axis: 'world_x', direction: 1 },
    };
    const result = calculateRequiredInstallationEnvelope({ x: 10, y: 20, z: 30 }, negative, {
      service: { x_min: 1, x_max: 9, y_min: 0, y_max: 0, z_min: 0, z_max: 0 },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        world_x: 30,
        world_y: 20,
        world_z: 20,
        clearance: { world_x: 0, world_y: 0, world_z: 10 },
        clearanceBySide: {
          world_z_min: 9,
          world_z_max: 1,
        },
      },
    });
  });

  it('transforms asymmetric face clearances with direction', () => {
    const result = calculateRequiredInstallationEnvelope({ x: 10, y: 20, z: 30 }, zToX, {
      service: { x_min: 1, x_max: 2, y_min: 0, y_max: 0, z_min: 3, z_max: 4 },
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        world_x: 37,
        world_y: 20,
        world_z: 13,
        body: { world_x: 30, world_y: 20, world_z: 10 },
        clearance: { world_x: 7, world_y: 0, world_z: 3 },
        clearanceBySide: {
          world_x_min: 3,
          world_x_max: 4,
          world_y_min: 0,
          world_y_max: 0,
          world_z_min: 1,
          world_z_max: 2,
        },
      },
    });
  });

  it('separates body and required envelopes and does not turn unknown clearance into zero', () => {
    const body = calculateBodyEnvelope({ x: 10, y: 20, z: 30 }, identity);
    const unresolved = calculateRequiredInstallationEnvelope({ x: 10, y: 20, z: 30 }, identity, {
      service: { x_min: 0, x_max: null, y_min: 0, y_max: 0, z_min: 0, z_max: 0 },
    });
    expect(body.value).toEqual({ world_x: 10, world_y: 20, world_z: 30 });
    expect(unresolved.status).toBe('unresolved');
    expect(unresolved.value).toBeUndefined();
    expect(
      calculateRequiredInstallationEnvelope(
        { x: 10, y: 20, z: 30 },
        identity,
        completeZeroClearance,
      ),
    ).toMatchObject({ ok: true, value: { world_x: 10, world_y: 20, world_z: 30 } });
    expect(
      calculateRequiredInstallationEnvelope({ x: 10, y: 20, z: 30 }, identity, {}),
    ).toMatchObject({ ok: true, value: { world_x: 10, world_y: 20, world_z: 30 } });
  });

  it('distinguishes unknown, unrestricted, and disallowed orientation constraints', () => {
    expect(isOrientationAllowed(identity, { status: 'unrestricted' })).toBe(true);
    expect(isOrientationAllowed(identity, { status: 'unknown' })).toBe(false);
    expect(
      isOrientationAllowed(identity, { status: 'restricted', allowedOrientationIds: ['other'] }),
    ).toBe(false);
    expect(
      isOrientationAllowed(
        identity,
        { status: 'restricted', allowedMountingFaces: ['z_min'] },
        'x_min',
      ),
    ).toBe(false);
    expect(isOrientationAllowed(undefined as never, { status: 'unrestricted' })).toBe(false);
    expect(
      isOrientationAllowed(identity, { status: 'unrestricted', allowedOrientationIds: ['other'] }),
    ).toBe(false);
    expect(isOrientationAllowed(identity, { status: 'restricted' })).toBe(false);
  });

  it('rejects contradictory, empty, duplicate, and malformed structured constraints', () => {
    expect(
      validateOrientationConstraint({
        status: 'unrestricted',
        allowedOrientationIds: ['foo'],
      }),
    ).not.toEqual([]);
    expect(validateOrientationConstraint({ status: 'restricted' })).not.toEqual([]);
    expect(
      validateOrientationConstraint({
        status: 'restricted',
        allowedOrientationIds: ['foo', 'foo'],
      }),
    ).not.toEqual([]);
    expect(
      validateOrientationConstraint({ status: 'restricted', allowedOrientationIds: [''] }),
    ).not.toEqual([]);
    expect(
      validateOrientationConstraint({ status: 'restricted', allowedOrientationIds: 'foo' }),
    ).not.toEqual([]);
  });

  it('is deterministic independent of clearance object key order', () => {
    const first = calculateRequiredInstallationEnvelope(
      { x: 10, y: 20, z: 30 },
      identity,
      completeZeroClearance,
    );
    const second = calculateRequiredInstallationEnvelope({ z: 30, x: 10, y: 20 }, identity, {
      service: { z_max: 0, y_max: 0, x_max: 0, z_min: 0, y_min: 0, x_min: 0 },
    });
    expect(second).toEqual(first);
  });
});
