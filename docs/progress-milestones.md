# Generating progress and activity milestones

The desktop conversation presents a user-facing milestone stream. Raw model
reasoning and individual agent operations are inputs to that stream, not the
stream itself.

## Three presentation layers

Generating work is presented as three independent layers:

1. **Activity history** records concrete actions such as commands, reads, and
   edits. Related actions may collapse into one expandable group. Settled rows
   remain static history.
2. **Progress updates** are short, ordinary-language Assistant messages between
   meaningful phases. They tell the user what was learned or achieved, any
   relevant challenge, and what comes next without exposing chain-of-thought.
3. **Live status** is one ephemeral shimmer row at the bottom of the current
   turn. It never becomes history: its copy changes from the initial request
   interpretation to the latest running operation, then to result synthesis
   between operations. It disappears when the turn finishes or pauses for the
   user.

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
| `summary` | Short text | Ordered action headline such as “Read files, ran commands”. |
| `achieved` | Optional text | What changed or was learned. |
| `challenge` | Optional text | A user-relevant risk or blocker. |
| `next` | Optional text | What the agent will do next. |
| `actionRefs` | Tool/call identifiers | Ordered trace shown inside the disclosure. |
| `retry` | `{ attempt, maximum, delayMs, reason }` | Compact, always-visible retry state. |

`progress_update` copy should contain only new user-relevant judgment. It may
state what was achieved, the current challenge, and the next step, but should
not narrate every operation or reproduce chain-of-thought.

## Lifecycle

1. A submitted query opens a `pending` milestone and mounts the live shimmer at
   the bottom with “Understanding the request…”. The live row is not a Think or
   reasoning disclosure.
2. A running Tool or command replaces that copy with the latest concrete
   operation, such as “Checking src/app.ts” or “Running npm test”. Completed
   actions settle into the activity history while the live row remains last.
3. Between operations, the live row names the current objective. It prefers the
   active Todo item, then the explicit “Next” objective from the latest progress
   update; only missing semantic context falls back to generic result synthesis.
   An active retry replaces the objective with retry copy.
4. The first `progress_update`, activity group, retry, blocker, question, or
   approval moves the milestone to `running`. Progress prose is inserted into
   history and does not replace or remove the live row.
5. Related actions are grouped by objective and phase. A progress update,
   blocker, question, approval, or user steering ends the current group.
6. A final assistant response completes the milestone and removes the live row.
   A terminal error marks it `failed`; a pending question, approval, or
   unresolved error marks it `blocked` and pauses the shimmer.

## Steer from here

Every settled `progress_update` in the session's latest user query exposes a
`Steer from here` text action. Progress updates from older queries do not. It
opens one inline comment field with the placeholder `What should change?` and
one `Steer` text button. There is no Cancel control: clicking outside the
field or pressing Escape closes it without changing the conversation. Enter
submits and Shift+Enter inserts a newline.

Submitting is the commit point. The client stops the active path, persistently
hides every existing conversation row after the selected progress update, and
shows `正在重新思考…` until new Assistant or tool activity arrives. It then sends
the comment and retained update as a follow-up in the same task. The internal
follow-up row is not presented in the transcript.

Version one is intentionally irreversible in the UI and does not expose a
branch or undo. The underlying runtime log is not physically rewritten. The
follow-up therefore declares all reasoning, tool results, conclusions, and
residual files from the discarded suffix invalid. The agent must ignore them
or independently revalidate them against the retained checkpoint and the new
comment before reuse.

## Visibility rules

- Context injection is hidden by default.
- Raw reasoning remains an optional collapsed debug disclosure. Its collapsed
  summary is generic and never supplies either progress prose or live status.
- Todo history rows are hidden; the latest Todo dock remains authoritative.
- A group with multiple actions is collapsed to one activity summary and can
  be expanded to the ordered tool trace. Its headline names the distinct action
  types in first-seen order (for example, “Read files, ran commands” or
  “Edited files, read files”) rather than reporting only an operation count.
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
