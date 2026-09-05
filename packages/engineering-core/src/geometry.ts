export type LocalAxis = 'x' | 'y' | 'z';
export type WorldAxis = 'world_x' | 'world_y' | 'world_z';
export type AxisDirection = 1 | -1;
export type LocalFace = 'x_min' | 'x_max' | 'y_min' | 'y_max' | 'z_min' | 'z_max';

export interface DimensionsMm {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AxisMapping {
  readonly axis: WorldAxis;
  readonly direction: AxisDirection;
}

export interface OrientationTransform {
  readonly id: string;
  readonly x: AxisMapping;
  readonly y: AxisMapping;
  readonly z: AxisMapping;
}

export interface OrientationConstraintSpec {
  readonly status: 'unrestricted' | 'restricted' | 'unknown';
  readonly allowedMountingFaces?: readonly LocalFace[];
  readonly prohibitedMountingFaces?: readonly LocalFace[];
  readonly allowedOrientationIds?: readonly string[];
}

export interface FaceClearancesMm {
  readonly x_min?: number | null;
  readonly x_max?: number | null;
  readonly y_min?: number | null;
  readonly y_max?: number | null;
  readonly z_min?: number | null;
  readonly z_max?: number | null;
}

export interface ClearanceRequirementsMm {
  readonly service?: FaceClearancesMm | null;
  readonly ventilation?: FaceClearancesMm | null;
  readonly cable_access?: FaceClearancesMm | null;
  readonly safety?: FaceClearancesMm | null;
}

export interface BodyEnvelopeMm {
  readonly world_x: number;
  readonly world_y: number;
  readonly world_z: number;
}

export interface WorldSideClearancesMm {
  readonly world_x_min: number;
  readonly world_x_max: number;
  readonly world_y_min: number;
  readonly world_y_max: number;
  readonly world_z_min: number;
  readonly world_z_max: number;
}

export interface RequiredEnvelopeMm extends BodyEnvelopeMm {
  readonly body: BodyEnvelopeMm;
  readonly clearance: BodyEnvelopeMm;
  readonly clearanceBySide: WorldSideClearancesMm;
}

export type GeometryStatus = 'valid' | 'unresolved' | 'invalid';

export interface GeometryIssue {
  readonly code:
    | 'geometry.invalid_dimensions'
    | 'geometry.invalid_orientation'
    | 'geometry.invalid_clearance'
    | 'geometry.orientation_not_allowed'
    | 'geometry.mounting_face_not_allowed'
    | 'geometry.unknown_clearance';
  readonly path: string;
  readonly message: string;
}

export interface GeometryResult<T> {
  readonly ok: boolean;
  readonly status: GeometryStatus;
  readonly value?: T;
  readonly issues: readonly GeometryIssue[];
}

const localAxes: readonly LocalAxis[] = ['x', 'y', 'z'];
const worldAxes: readonly WorldAxis[] = ['world_x', 'world_y', 'world_z'];
const faces: readonly LocalFace[] = ['x_min', 'x_max', 'y_min', 'y_max', 'z_min', 'z_max'];

const issue = (code: GeometryIssue['code'], path: string, message: string): GeometryIssue => ({
  code,
  path,
  message,
});

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const validateDimensionsMm = (dimensions: unknown): GeometryIssue[] => {
  if (dimensions === null || typeof dimensions !== 'object') {
    return [issue('geometry.invalid_dimensions', 'dimensions_mm', 'dimensions must be an object.')];
  }
  const record = dimensions as Record<string, unknown>;
  return localAxes.flatMap((axis) =>
    isFinitePositive(record[axis])
      ? []
      : [
          issue(
            'geometry.invalid_dimensions',
            `dimensions_mm.${axis}`,
            'physical dimensions must be finite and strictly greater than zero.',
          ),
        ],
  );
};

export const validateOrientationTransform = (transform: unknown): GeometryIssue[] => {
  if (transform === null || typeof transform !== 'object') {
    return [issue('geometry.invalid_orientation', 'orientation', 'orientation must be an object.')];
  }
  const record = transform as Record<string, unknown>;
  const mappings = localAxes.map((axis) => record[axis]);
  const issues: GeometryIssue[] = [];
  const seenAxes = new Set<WorldAxis>();

  mappings.forEach((mapping, index) => {
    const localAxis = localAxes[index];
    if (mapping === null || typeof mapping !== 'object') {
      issues.push(
        issue(
          'geometry.invalid_orientation',
          `orientation.${localAxis}`,
          'each local axis requires a world-axis mapping.',
        ),
      );
      return;
    }
    const value = mapping as Record<string, unknown>;
    if (!worldAxes.includes(value.axis as WorldAxis)) {
      issues.push(
        issue(
          'geometry.invalid_orientation',
          `orientation.${localAxis}.axis`,
          'must be world_x, world_y, or world_z.',
        ),
      );
    } else if (seenAxes.has(value.axis as WorldAxis)) {
      issues.push(
        issue(
          'geometry.invalid_orientation',
          `orientation.${localAxis}.axis`,
          'each world axis may be mapped from only one local axis.',
        ),
      );
    } else {
      seenAxes.add(value.axis as WorldAxis);
    }
    if (value.direction !== 1 && value.direction !== -1) {
      issues.push(
        issue(
          'geometry.invalid_orientation',
          `orientation.${localAxis}.direction`,
          'must be 1 or -1.',
        ),
      );
    }
  });

  if (seenAxes.size !== worldAxes.length) {
    issues.push(
      issue(
        'geometry.invalid_orientation',
        'orientation',
        'all three distinct world axes are required.',
      ),
    );
  }
  if (typeof record.id !== 'string' || record.id.trim() === '') {
    issues.push(
      issue(
        'geometry.invalid_orientation',
        'orientation.id',
        'a stable non-empty orientation ID is required.',
      ),
    );
  }
  return issues;
};

const faceMapping = (
  face: LocalFace,
  transform: OrientationTransform,
): { axis: WorldAxis; direction: AxisDirection } => {
  const localAxis = face[0] as LocalAxis;
  const faceDirection = face.endsWith('_min') ? -1 : 1;
  const mapping = transform[localAxis];
  return { axis: mapping.axis, direction: (faceDirection * mapping.direction) as AxisDirection };
};

const addExtent = (result: Record<WorldAxis, number>, axis: WorldAxis, value: number): void => {
  result[axis] += value;
};

export const calculateBodyEnvelope = (
  dimensions: DimensionsMm,
  transform: OrientationTransform,
): GeometryResult<BodyEnvelopeMm> => {
  const issues = [...validateDimensionsMm(dimensions), ...validateOrientationTransform(transform)];
  if (issues.length > 0) return { ok: false, status: 'invalid', issues };

  const envelope: Record<WorldAxis, number> = { world_x: 0, world_y: 0, world_z: 0 };
  localAxes.forEach((axis) => addExtent(envelope, transform[axis].axis, dimensions[axis]));
  return { ok: true, status: 'valid', value: envelope, issues: [] };
};

const validateClearances = (requirements: ClearanceRequirementsMm): GeometryIssue[] => {
  const issues: GeometryIssue[] = [];
  (Object.entries(requirements) as Array<[string, FaceClearancesMm | null | undefined]>).forEach(
    ([category, clearance]) => {
      if (clearance === null || clearance === undefined) return;
      faces.forEach((face) => {
        const value = clearance[face];
        if (value !== undefined && value !== null && !isFiniteNonNegative(value)) {
          issues.push(
            issue(
              'geometry.invalid_clearance',
              `clearances.${category}.${face}`,
              'known clearance must be finite and greater than or equal to zero.',
            ),
          );
        }
      });
    },
  );
  return issues;
};

export const validateOrientationConstraint = (constraint: unknown): GeometryIssue[] => {
  if (constraint === null || typeof constraint !== 'object') {
    return [
      issue(
        'geometry.invalid_orientation',
        'orientation_constraint',
        'orientation constraint must be an object.',
      ),
    ];
  }
  const record = constraint as Record<string, unknown>;
  const status = record.status;
  const allowed = record.allowedMountingFaces;
  const prohibited = record.prohibitedMountingFaces;
  const orientationIds = record.allowedOrientationIds;
  const issues: GeometryIssue[] = [];
  if (!['unrestricted', 'restricted', 'unknown'].includes(status as string)) {
    issues.push(
      issue(
        'geometry.invalid_orientation',
        'orientation_constraint.status',
        'must be unrestricted, restricted, or unknown.',
      ),
    );
  }
  if (allowed !== undefined && !Array.isArray(allowed)) {
    issues.push(
      issue(
        'geometry.invalid_orientation',
        'orientation_constraint.allowedMountingFaces',
        'must be an array.',
      ),
    );
  }
  if (prohibited !== undefined && !Array.isArray(prohibited)) {
    issues.push(
      issue(
        'geometry.invalid_orientation',
        'orientation_constraint.prohibitedMountingFaces',
        'must be an array.',
      ),
    );
  }
  if (orientationIds !== undefined && !Array.isArray(orientationIds)) {
    issues.push(
      issue(
        'geometry.invalid_orientation',
        'orientation_constraint.allowedOrientationIds',
        'must be an array.',
      ),
    );
  }
  const allowedFaces = Array.isArray(allowed) ? allowed : [];
  const prohibitedFaces = Array.isArray(prohibited) ? prohibited : [];
  [...allowedFaces, ...prohibitedFaces].forEach((face, index) => {
    if (!faces.includes(face)) {
      issues.push(
        issue(
          'geometry.invalid_orientation',
          `orientation_constraint.faces[${index}]`,
          'must be a valid local face.',
        ),
      );
    }
  });
  if (
    new Set(allowedFaces).size !== allowedFaces.length ||
    new Set(prohibitedFaces).size !== prohibitedFaces.length
  ) {
    issues.push(
      issue(
        'geometry.invalid_orientation',
        'orientation_constraint',
        'face restrictions must not contain duplicates.',
      ),
    );
  }
  if (Array.isArray(orientationIds)) {
    orientationIds.forEach((id, index) => {
      if (typeof id !== 'string' || id.trim() === '') {
        issues.push(
          issue(
            'geometry.invalid_orientation',
            `orientation_constraint.allowedOrientationIds[${index}]`,
            'must contain non-empty strings.',
          ),
        );
      }
    });
    if (new Set(orientationIds).size !== orientationIds.length) {
      issues.push(
        issue(
          'geometry.invalid_orientation',
          'orientation_constraint.allowedOrientationIds',
          'orientation IDs must not contain duplicates.',
        ),
      );
    }
  }
  const hasRestriction =
    allowedFaces.length > 0 ||
    prohibitedFaces.length > 0 ||
    (Array.isArray(orientationIds) && orientationIds.length > 0);
  const hasRestrictionFields =
    allowed !== undefined || prohibited !== undefined || orientationIds !== undefined;
  if ((status === 'unrestricted' || status === 'unknown') && hasRestrictionFields) {
    issues.push(
      issue(
        'geometry.invalid_orientation',
        'orientation_constraint',
        'unrestricted constraints must not contain restrictions.',
      ),
    );
  }
  if (status === 'restricted' && !hasRestriction) {
    issues.push(
      issue(
        'geometry.invalid_orientation',
        'orientation_constraint',
        'restricted constraints require at least one meaningful restriction.',
      ),
    );
  }
  return issues;
};

export const isOrientationAllowed = (
  transform: OrientationTransform,
  constraint: OrientationConstraintSpec,
  mountingFace?: LocalFace,
): boolean => {
  if (
    validateOrientationTransform(transform).length > 0 ||
    validateOrientationConstraint(constraint).length > 0 ||
    constraint.status === 'unknown'
  ) {
    return false;
  }
  if (
    constraint.allowedOrientationIds &&
    !constraint.allowedOrientationIds.includes(transform.id)
  ) {
    return false;
  }
  if (mountingFace) {
    if (
      constraint.allowedMountingFaces &&
      !constraint.allowedMountingFaces.includes(mountingFace)
    ) {
      return false;
    }
    if (constraint.prohibitedMountingFaces?.includes(mountingFace)) return false;
  }
  return true;
};

export const transformLocalFace = (
  face: LocalFace,
  transform: OrientationTransform,
): `${WorldAxis}_${'min' | 'max'}` => {
  const mapped = faceMapping(face, transform);
  return `${mapped.axis}_${mapped.direction === 1 ? 'max' : 'min'}`;
};

export const calculateRequiredInstallationEnvelope = (
  dimensions: DimensionsMm,
  transform: OrientationTransform,
  clearances: ClearanceRequirementsMm,
  constraint?: OrientationConstraintSpec,
  mountingFace?: LocalFace,
): GeometryResult<RequiredEnvelopeMm> => {
  const body = calculateBodyEnvelope(dimensions, transform);
  const issues = [...body.issues, ...validateClearances(clearances)];
  if (constraint) {
    const constraintIssues = validateOrientationConstraint(constraint);
    issues.push(...constraintIssues);
    if (
      constraintIssues.length === 0 &&
      !isOrientationAllowed(transform, constraint, mountingFace)
    ) {
      issues.push(
        issue(
          mountingFace ? 'geometry.mounting_face_not_allowed' : 'geometry.orientation_not_allowed',
          mountingFace ? 'mounting_face' : 'orientation.id',
          'the selected installation orientation is not permitted by the orientation constraint.',
        ),
      );
    }
  }
  if (
    issues.length > 0 &&
    issues.some(
      (entry) =>
        entry.code.startsWith('geometry.invalid') ||
        entry.code === 'geometry.orientation_not_allowed' ||
        entry.code === 'geometry.mounting_face_not_allowed',
    )
  ) {
    return { ok: false, status: 'invalid', issues };
  }

  const clearanceBySide: Record<keyof WorldSideClearancesMm, number> = {
    world_x_min: 0,
    world_x_max: 0,
    world_y_min: 0,
    world_y_max: 0,
    world_z_min: 0,
    world_z_max: 0,
  };
  let unresolved = false;
  const categories = [
    clearances.service,
    clearances.ventilation,
    clearances.cable_access,
    clearances.safety,
  ].filter((category): category is FaceClearancesMm | null => category !== undefined);
  faces.forEach((face) => {
    const values = categories.map((category) => category?.[face]);
    if (categories.length > 0 && values.some((value) => value === null || value === undefined)) {
      unresolved = true;
    }
    const knownValues = values.filter((value): value is number => typeof value === 'number');
    const maximum = knownValues.length > 0 ? Math.max(...knownValues) : 0;
    const mapped = faceMapping(face, transform);
    const side =
      `${mapped.axis}_${mapped.direction === 1 ? 'max' : 'min'}` as keyof WorldSideClearancesMm;
    clearanceBySide[side] = maximum;
  });
  if (unresolved) {
    return {
      ok: false,
      status: 'unresolved',
      issues: [
        ...issues,
        issue(
          'geometry.unknown_clearance',
          'clearances',
          'one or more required face clearances are unknown and cannot be treated as zero.',
        ),
      ],
    };
  }

  const bodyValue = body.value as BodyEnvelopeMm;
  const clearanceExtent: BodyEnvelopeMm = {
    world_x: clearanceBySide.world_x_min + clearanceBySide.world_x_max,
    world_y: clearanceBySide.world_y_min + clearanceBySide.world_y_max,
    world_z: clearanceBySide.world_z_min + clearanceBySide.world_z_max,
  };
  const value = {
    world_x: bodyValue.world_x + clearanceExtent.world_x,
    world_y: bodyValue.world_y + clearanceExtent.world_y,
    world_z: bodyValue.world_z + clearanceExtent.world_z,
    body: bodyValue,
    clearance: clearanceExtent,
    clearanceBySide,
  };
  return { ok: true, status: 'valid', value, issues };
};
