export const MODULE_PERMISSIONS = [
  "contacts.read", "contacts.write",
  "pipeline.read", "pipeline.write",
  "conversations.read", "conversations.reply", "conversations.manage",
  "agenda.read", "agenda.write",
  "campaigns.read", "campaigns.write",
  "automations.read", "automations.write",
  "reports.read", "data.import_export",
] as const;

export type ModulePermission = (typeof MODULE_PERMISSIONS)[number];
