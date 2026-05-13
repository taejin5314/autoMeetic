---
description: These instructions should be loaded for all tasks related to inter-process communication (IPC) in the project.
applyTo: 'src/**/*.ts, src/**/*.tsx'
---

# IPC Action and Event Instructions

Valid action names should be present tense verbs, e.g. `update-video`, `delete-folder`, `create-page`.
Valid event names should be present tense to match EventEmitter conventions, e.g. `video-update`, `folder-delete`, `page-create`.
Preload actions should be named using camelCase, e.g. `updateVideo`, `deleteFolder`, `createPage`.
Preload events should be named using camelCase prefixed with "on", e.g. `onVideoUpdate`, `onFolderDelete`, `onPageCreate`.
Preload types in `src/preload/types.ts` must be updated to reflect any new IPC events or actions.
Preload implementation `src/preload/index.ts` must be updated to create the IPC events or actions for the renderer process to consume.
Main process services must update `registerIpcHandlers` to handle any new IPC actions.
Main process services must update `registerWindowNotifiers` to notify renderer processes of events.
Ipc actions must not use file paths in parameters for security reasons.
