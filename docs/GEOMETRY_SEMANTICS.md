# Mounting geometry semantics

`dimensions_mm` describes only the physical enclosure in the component-local frame:

- `x` is local width, `y` is local depth, and `z` is local height.
- These axes do not imply vehicle, cabinet, or world directions.
- Manufacturer “depth” is not automatically distance from a mounting wall.

Installation geometry is derived in four separate steps:

`PHYSICAL BODY DIMENSIONS != MOUNTING ORIENTATION != INSTALLED BODY ENVELOPE != REQUIRED INSTALLATION ENVELOPE != AVAILABLE INSTALLATION SPACE`

The geometry kernel maps local axes to caller-supplied `world_x`, `world_y`, and
`world_z` using discrete signed orthogonal transforms. The selected transform must
be permitted by the component's orientation constraint. A structured constraint
can restrict local mounting faces or stable orientation IDs; `unknown` is
uncertainty, not permission, and arbitrary product rotation is never assumed.

Face-relative clearances are separate from body dimensions. Local face clearances
may be categorized as service, ventilation, cable access, or safety requirements.
Known zero is distinct from missing or `null`; unresolved clearance prevents a
complete required installation envelope from being returned. An absent clearance
category means that category is not asserted by the calculation input; a present
category with a missing or null face is unresolved. Cable bend radius is not
silently added to the body dimensions.

Available installation space belongs to the installation context. Fit evaluation
must compare that space with an explicitly derived installed body or required
envelope. Identity orientation is never silently assumed, and asymmetric
clearances remain available as transformed world-side values for future placement
logic.
