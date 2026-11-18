/// <reference path="../pb_data/types.d.ts" />

// Read-only API keys (Settings → API Access). Only a SHA-256 hash of each key is stored;
// the key itself is shown once when it's created.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const keys = new Collection({
    type: "base",
    name: "api_keys",
    // Only the server reads and writes these (through /api/ch/api-keys), never the app directly.
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "name", type: "text", required: true, max: 80 },
      { name: "prefix", type: "text", required: true, max: 20 },
      { name: "hash", type: "text", required: true, max: 64 },
      { name: "created_by", type: "relation", maxSelect: 1, collectionId: users.id },
      { name: "last_used_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_api_keys_hash ON api_keys (hash)"],
  })
  app.save(keys)
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("api_keys"))
  } catch (_) {}
})
