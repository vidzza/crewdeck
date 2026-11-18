/// <reference path="../pb_data/types.d.ts" />

// Team hierarchy: Owner > Admin > Manager > Employee.
// Admins add and edit managers and employees only. Making, editing or deactivating
// an admin (or the owner) is up to the owner. Nobody changes their own access level.

migrate(
  (app) => {
    const AUTH = '@request.auth.id != "" && @request.auth.collectionName = "users" && @request.auth.active = true'
    const IS_OWNER = '@request.auth.access = "owner"'
    const IS_ADMIN = '@request.auth.access = "admin"'
    const SELF =
      "(id = @request.auth.id && @request.body.access:isset = false && @request.body.active:isset = false && @request.body.positions:isset = false && @request.body.locations:isset = false && @request.body.joined_at:isset = false)"
    const below = (f) => f + ' != "owner" && ' + f + ' != "admin"'

    const users = app.findCollectionByNameOrId("users")
    users.createRule = AUTH + " && (" + IS_OWNER + " || (" + IS_ADMIN + " && " + below("@request.body.access") + "))"
    users.updateRule =
      "(" + AUTH + " && (" + IS_OWNER + " || (" + IS_ADMIN + " && " + below("access") + " && " + below("@request.body.access") + "))) || " + SELF
    users.manageRule = AUTH + " && (" + IS_OWNER + " || (" + IS_ADMIN + " && " + below("access") + "))"
    app.save(users)
  },
  (app) => {
    const AUTH = '@request.auth.id != "" && @request.auth.collectionName = "users" && @request.auth.active = true'
    const ADMIN = '(@request.auth.access = "owner" || @request.auth.access = "admin")'
    const SELF =
      "(id = @request.auth.id && @request.body.access:isset = false && @request.body.active:isset = false && @request.body.positions:isset = false && @request.body.locations:isset = false && @request.body.joined_at:isset = false)"

    const users = app.findCollectionByNameOrId("users")
    users.createRule = AUTH + " && " + ADMIN + ' && (@request.auth.access = "owner" || @request.body.access != "owner")'
    users.updateRule =
      "(" + AUTH + " && " + ADMIN + ' && (@request.auth.access = "owner" || (access != "owner" && @request.body.access != "owner"))) || ' + SELF
    users.manageRule = AUTH + " && " + ADMIN + ' && (@request.auth.access = "owner" || access != "owner")'
    app.save(users)
  },
)
