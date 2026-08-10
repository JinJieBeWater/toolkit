---
name: lark
description: "Operate the user's Feishu/Lark workspace with lark-cli. Use for messages, docs, Drive, Wiki, Base, Sheets, Slides, calendar, tasks, mail, meetings, approvals, contacts, attendance, OKRs, notes, events, or raw OpenAPI calls."
license: "MIT; upstream notices fetched by scripts/sync-upstream.sh"
compatibility: "Requires git and network for first-run sync, plus lark-cli and Feishu/Lark application authorization."
---

# Lark

## Workflow

1. Resolve this `SKILL.md`'s directory. If `references/upstream/lark-shared/DOMAIN.md` is missing, run `scripts/sync-upstream.sh` from that directory and require a successful exit.
2. Read `references/upstream/lark-shared/DOMAIN.md` before configuration, authentication, or any business-domain operation.
3. Route the request with the table below. Read only the selected `DOMAIN.md`; follow its bundled references only when that branch requires them.
4. Prefer `--as user` for the user's private workspace. Use bot identity only when the user requests application/bot behavior.
5. Execute through `lark-cli`. Treat exit status and JSON `ok` as truth; follow upstream confirmation and missing-scope recovery exactly.
6. Verify reads from returned data. Verify writes by the command result or a targeted read-back when the domain guide requires it.

Do not load every domain file. Multi-domain work may read multiple selected domains after `lark-shared`.

## Route

| User object or action                             | Read                                                          |
| ------------------------------------------------- | ------------------------------------------------------------- |
| Setup, login, scopes, identity, auth errors       | `references/upstream/lark-shared/DOMAIN.md`                   |
| Messages, chats, threads, reactions, IM files     | `references/upstream/lark-im/DOMAIN.md`                       |
| Documents and document content                    | `references/upstream/lark-doc/DOMAIN.md`                      |
| Drive files, permissions, comments, import/export | `references/upstream/lark-drive/DOMAIN.md`                    |
| Wiki spaces and nodes                             | `references/upstream/lark-wiki/DOMAIN.md`                     |
| Base / multidimensional tables                    | `references/upstream/lark-base/DOMAIN.md`                     |
| Sheets / spreadsheets                             | `references/upstream/lark-sheets/DOMAIN.md`                   |
| Slides / presentations                            | `references/upstream/lark-slides/DOMAIN.md`                   |
| Drive-native Markdown files                       | `references/upstream/lark-markdown/DOMAIN.md`                 |
| Calendar, events, rooms, free/busy                | `references/upstream/lark-calendar/DOMAIN.md`                 |
| Tasks and task lists                              | `references/upstream/lark-task/DOMAIN.md`                     |
| Mail                                              | `references/upstream/lark-mail/DOMAIN.md`                     |
| Contacts and user lookup                          | `references/upstream/lark-contact/DOMAIN.md`                  |
| Meetings and recordings                           | `references/upstream/lark-vc/DOMAIN.md`                       |
| Meeting agent workflows                           | `references/upstream/lark-vc-agent/DOMAIN.md`                 |
| Minutes, transcripts, summaries, recordings       | `references/upstream/lark-minutes/DOMAIN.md`                  |
| Approval instances and approval actions           | `references/upstream/lark-approval/DOMAIN.md`                 |
| Attendance                                        | `references/upstream/lark-attendance/DOMAIN.md`               |
| OKRs                                              | `references/upstream/lark-okr/DOMAIN.md`                      |
| Notes                                             | `references/upstream/lark-note/DOMAIN.md`                     |
| Whiteboards                                       | `references/upstream/lark-whiteboard/DOMAIN.md`               |
| Real-time event subscriptions                     | `references/upstream/lark-event/DOMAIN.md`                    |
| Apps / Miaoda                                     | `references/upstream/lark-apps/DOMAIN.md`                     |
| OpenAPI discovery or uncovered APIs               | `references/upstream/lark-openapi-explorer/DOMAIN.md`         |
| Build a reusable Lark workflow                    | `references/upstream/lark-skill-maker/DOMAIN.md`              |
| Meeting-summary workflow                          | `references/upstream/lark-workflow-meeting-summary/DOMAIN.md` |
| Stand-up report workflow                          | `references/upstream/lark-workflow-standup-report/DOMAIN.md`  |

## Maintenance

Run `scripts/sync-upstream.sh` to refresh all official domain guides. It downloads the official `larksuite/cli` `skills/` tree into the installed skill, renames nested `SKILL.md` files to `DOMAIN.md`, rewrites their links, and records the upstream commit without exposing extra Pi skills. Synced files are installation state, not repository source.
