# Rebind child return channels

Use only when parent rotates while children are active. These messages update the return channel.

1. Source parent sends every child successor as new primary in parallel. Preserve an existing live coordinator fallback when it differs from source; if fallback is source or absent, replace it with successor.
2. Each child updates future terminal and blocker targets, then sends successor exactly one acknowledgment:

   ```text
   [转生改绑完成][<task-id>]
   Source: <old-parent-id>
   Successor: <new-parent-id>
   ```

3. Successor receives expected child task IDs, structured-HITL task IDs, and conditional source-closure authority in its initial prompt. Ready reports `[转生接管等待]` and returns idle; Continue starts `Exact next action` immediately. Both stay event-driven and treat each later evidence message atomically.
4. If child is inside structured HITL, source cancels only that UI without choosing an answer and delivers rebind. Child sends binding acknowledgment, then re-presents the identical question. Source waits once for that exact question to become visible and sends successor:

   ```text
   [HITL重现完成][<task-id>]
   Child: <pane-id>; Question: <stable fingerprint or exact short text>
   ```

   Other children remain uninterrupted. A failed visibility wait keeps source open.

5. The last required binding acknowledgment or HITL-visibility proof directly authorizes successor to close source.

Rebind completes when every expected binding acknowledgment and required HITL proof is visible in successor and successor closes source.
