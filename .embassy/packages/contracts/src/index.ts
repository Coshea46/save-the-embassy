import { z } from "zod";

export const integer = z.number().int().nonnegative();
const positive = integer.min(1);
const text = z.string().trim().min(1);
export const positionSchema = z.strictObject({ x: integer, y: integer });
export type Position = z.infer<typeof positionSchema>;
export const rooms = [
  "reception",
  "office",
  "kitchen",
  "sauna",
  "plant",
  "archive",
] as const;
export const roomSchema = z.enum(rooms);
export type Room = z.infer<typeof roomSchema>;
export const categoryTargets = {
  maintenance: 90,
  administration: 70,
  it: 70,
  protocol: 65,
  food: 55,
  security: 55,
  culture: 50,
  gaming: 75,
  surreal: 70,
} as const;
export const definitionSchema = z.strictObject({
  id: text.regex(/^[a-z][a-z0-9_]*$/),
  title: text,
  description: text.min(12),
  category: z.enum(
    Object.keys(categoryTargets) as [
      keyof typeof categoryTargets,
      ...(keyof typeof categoryTargets)[],
    ],
  ),
  rooms: z.array(roomSchema).nonempty(),
  weight: positive.max(1000),
});
export type Definition = z.infer<typeof definitionSchema>;
export const catalogueSchema = z.strictObject({
  version: text,
  definitions: z.array(definitionSchema).nonempty(),
});
export type Catalogue = z.infer<typeof catalogueSchema>;
export const manifestSchema = z.strictObject({
  scenario_id: text,
  ruleset_version: text,
  catalogue_version: text,
});
export type Manifest = z.infer<typeof manifestSchema>;
export const eventSchema = z
  .strictObject({
    id: text,
    spawn: integer,
    position: positionSchema,
    room: roomSchema,
    priority: positive.max(10),
    reward: positive,
    duration: positive,
    deadline: positive,
    mandatory: z.boolean(),
  })
  .refine((t) => t.deadline > t.spawn, "Deadline must follow spawn");
export type CanonicalEvent = z.infer<typeof eventSchema>;
export const instanceSchema = eventSchema.safeExtend({ definition_id: text });
export type Incident = z.infer<typeof instanceSchema>;
export const taskViewSchema = z
  .strictObject({
    id: text,
    title: text,
    description: text,
    priority: positive.max(10),
    reward: positive,
    mandatory: z.boolean(),
    time_remaining: positive,
    duration: positive,
    position: positionSchema,
    distance: integer,
    estimated_travel_time: integer,
    slack: z.number().int(),
    urgency: z.enum(["normal", "urgent", "very_urgent", "critical"]),
  })
  .refine(
    (t) => t.slack === t.time_remaining - t.estimated_travel_time - t.duration,
    "Incorrect slack",
  );
export const observationSchema = z.strictObject({
  simulation_time: integer,
  agent: z.strictObject({
    position: positionSchema,
    current_task_id: text.nullable(),
  }),
  available_tasks: z.array(taskViewSchema),
});
export type Observation = z.infer<typeof observationSchema>;
export type Decision = string | null;
export type Strategy = (observation: Observation) => Decision;
export const metricsSchema = z.strictObject({
  score: integer,
  survival_ticks: integer,
  completed: integer,
  failed: integer,
  travel: integer,
  offered_work: integer,
  offered_reward: integer,
  work_ticks: integer,
  idle_ticks: integer,
  optional_points: integer,
  mandatory_points: integer,
});
export type Metrics = z.infer<typeof metricsSchema>;
const id = z.string().uuid();
const nickname = text.max(32);
export const statusSchema = z.strictObject({
  run_id: id,
  manifest: manifestSchema,
  next_sequence: integer,
  tick: integer,
  status: z.enum(["playing", "closed", "finished"]),
  metrics: metricsSchema,
  observation: observationSchema.nullable(),
});
const entry = z.strictObject({
  rank: positive,
  display_name: nickname,
  score: integer,
  survival_ticks: integer,
});
export const batchLimit = 32;
const journalDecision = z.strictObject({
  sequence: integer,
  tick: integer,
  selected_task_id: text.max(128).nullable(),
  idempotency_key: id,
});
export const assignmentSchema = z.strictObject({
  protocol: z.literal(2),
  run_id: id,
  deadline: z.iso.datetime(),
  scenario: z.strictObject({
    seed: integer.max(0xffffffff),
    manifest: manifestSchema,
    rules: z.strictObject({
      version: text,
      horizon: positive,
      urgency: z.tuple([integer, integer, integer]),
      stages: z
        .array(
          z.strictObject({
            start: integer,
            gap: positive,
            duration: positive,
            slack: integer,
            farWeight: positive,
            mandatoryEvery: positive,
          }),
        )
        .nonempty(),
      bands: z
        .array(
          z.strictObject({
            reward: positive,
            priority: positive,
            extraWork: integer,
          }),
        )
        .nonempty(),
    }),
    events: z.array(instanceSchema),
  }),
  catalogue: catalogueSchema,
});
export const rest = {
  assign: {
    method: "POST",
    path: "/v2/workshops/:workshop_id/runs",
    request: z.strictObject({ idempotency_key: id }),
    response: assignmentSchema,
  },
  batch: {
    method: "POST",
    path: "/v2/runs/:run_id/decisions",
    request: z.strictObject({
      decisions: z.array(journalDecision).min(1).max(batchLimit),
    }),
    response: z.strictObject({
      run_id: id,
      next_sequence: integer,
      score: integer,
    }),
  },
  register: {
    method: "POST",
    path: "/participants",
    request: z.strictObject({ display_name: nickname }),
    response: z.strictObject({ participant_id: id, access_token: text }),
  },
  join: {
    method: "POST",
    path: "/workshops/:workshop_id/join",
    request: z.strictObject({ join_code: text }),
    response: z.strictObject({ workshop_id: id, participant_id: id }),
  },
  start: {
    method: "POST",
    path: "/workshops/:workshop_id/runs",
    request: z.strictObject({ idempotency_key: id }),
    response: statusSchema,
  },
  decide: {
    method: "POST",
    path: "/runs/:run_id/decisions",
    request: z.strictObject({
      sequence: integer,
      selected_task_id: text.nullable(),
      idempotency_key: id,
    }),
    response: statusSchema,
  },
  status: {
    method: "GET",
    path: "/runs/:run_id",
    request: z.strictObject({}),
    response: statusSchema,
  },
  finish: {
    method: "POST",
    path: "/runs/:run_id/finish",
    request: z.strictObject({ sequence: integer, idempotency_key: id }),
    response: statusSchema,
  },
  leaderboard: {
    method: "GET",
    path: "/workshops/:workshop_id/leaderboard",
    request: z.strictObject({}),
    response: z.strictObject({ workshop_id: id, entries: z.array(entry) }),
  },
} as const;
export type RunStatus = z.infer<typeof statusSchema>;
export type DecisionRequest = z.infer<typeof rest.decide.request>;
