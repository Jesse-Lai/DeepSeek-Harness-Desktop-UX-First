# Generating progress and activity milestones

The desktop conversation presents a user-facing milestone stream. Raw model
reasoning and individual agent operations are inputs to that stream, not the
stream itself.

## Event contract

New producers should attach these fields to conversation events. The desktop
plugin also projects legacy events into the same fields as `data-dsh-*`
attributes so the renderer can migrate independently from the runtime.

| Field | Values | Purpose |
| --- | --- | --- |
| `kind` | `progress_update`, `activity_group`, `retry`, `blocker`, `question`, `approval` | Selects presentation and visibility policy. |
| `milestoneId` | Stable string | Groups user-facing progress for one objective. |
| `groupId` | Stable string | Groups related agent actions inside a milestone. |
| `status` | `pending`, `running`, `completed`, `blocked`, `failed` | Drives lifecycle and accessible status. |
| `visibility` | `primary`, `summary`, `detail`, `debug` | Defines the default disclosure level. |
| `summary` | Short text | Activity headline such as “Checked 6 files”. |
| `achieved` | Optional text | What changed or was learned. |
| `challenge` | Optional text | A user-relevant risk or blocker. |
| `next` | Optional text | What the agent will do next. |
| `actionRefs` | Tool/call identifiers | Ordered trace shown inside the disclosure. |
| `retry` | `{ attempt, maximum, delayMs, reason }` | Compact, always-visible retry state. |

`progress_update` copy should contain only new user-relevant judgment. It may
state what was achieved, the current challenge, and the next step, but should
not narrate every operation or reproduce chain-of-thought.

## Lifecycle

1. A submitted query opens a `pending` milestone.
2. Until semantic progress exists, the running Think row says “Understanding
   the request…”; if no reasoning row exists, the generic turn status provides
   the same fallback.
3. The first `progress_update`, activity group, retry, blocker, question, or
   approval moves the milestone to `running` and replaces the fallback.
4. Related actions are grouped by objective and phase. A progress update,
   blocker, question, approval, or user steering ends the current group.
5. A final assistant response completes the milestone. A terminal error marks
   it `failed`; a question, approval, or unresolved error marks it `blocked`.

## Visibility rules

- Context injection is hidden by default.
- Raw reasoning remains an optional collapsed debug disclosure. Its collapsed
  summary is generic and never exposes raw reasoning as progress.
- Todo history rows are hidden; the latest Todo dock remains authoritative.
- A group with multiple actions is collapsed to one activity summary and can
  be expanded to the ordered tool trace.
- A recovered tool error stays in activity details. An unresolved tool error
  or turn error is presented as a blocker.
- Model retry is visible while active. Settled retry history stays compact and
  its technical reason remains expandable.
- Questions and approvals are always immediate and never folded into groups.

## Legacy grouping

For events without `milestoneId`, the desktop assigns a milestone from the
latest user message. Adjacent Tool or command rows form one group. Todo,
question, approval, active retry, and unresolved errors are excluded from
grouping. The first row stores the summary and expansion state; every original
row remains mounted so React and tool inspection retain ownership.
