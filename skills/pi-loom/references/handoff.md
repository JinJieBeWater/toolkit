# Transfer ownership

Use when another Pi replaces current Pi or current Pi starts from transferred state.

## Select direction

| Situation                                         | Direction   | Completion                                                                          |
| ------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| Current Pi relinquishes final responsibility      | **Send**    | Read [Send ownership](handoff-send.md) and complete its four gates                  |
| Current Pi starts with transferred responsibility | **Receive** | Read [Receive ownership](handoff-receive.md) and complete its restoration criterion |

`转生` selects Send only when requested as an action, not when quoted as vocabulary. Load exactly one direction.

Transfer completes at the selected direction's criterion with exactly one current owner.

## Authority

The independent `handoff` Skill owns transfer artifact format and content. This reference owns Herdr coordination, successor acceptance, child return-channel continuity, and source closure authority.
