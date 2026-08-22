# API Contract Change

If the diff changes the parameters, return type, or path of an exported
route handler (Fastify route, REST endpoint) without also changing a version
identifier (route path version segment, or an explicit schema version field),
flag it as a WARNING finding: "breaking API contract change without a
version bump", citing the changed handler's file:line.