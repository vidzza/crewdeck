// Crewdeck server: PocketBase 0.40.6 set up exactly like the official binary
// (same flags, JS hooks in pb_hooks, JS migrations in pb_migrations, static app in pb_public),
// plus Web Push (push.go), which PocketBase's JS hooks can't do on their own.
//
// The official binary's self-update command is left out on purpose: Crewdeck updates
// through backend/scripts/crewdeck-update.sh.
package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/osutils"
)

func main() {
	app := pocketbase.New()

	var hooksDir string
	app.RootCmd.PersistentFlags().StringVar(&hooksDir, "hooksDir", "", "the directory with the JS app hooks")

	var hooksWatch bool
	app.RootCmd.PersistentFlags().BoolVar(&hooksWatch, "hooksWatch", true, "auto restart the app on pb_hooks file change; it has no effect on Windows")

	var hooksPool int
	app.RootCmd.PersistentFlags().IntVar(&hooksPool, "hooksPool", 15, "the total prewarm goja.Runtime instances for the JS app hooks execution")

	var migrationsDir string
	app.RootCmd.PersistentFlags().StringVar(&migrationsDir, "migrationsDir", "", "the directory with the user defined migrations")

	var automigrate bool
	app.RootCmd.PersistentFlags().BoolVar(&automigrate, "automigrate", true, "enable/disable auto migrations")

	var publicDir string
	app.RootCmd.PersistentFlags().StringVar(&publicDir, "publicDir", defaultPublicDir(), "the directory to serve static files")

	var indexFallback bool
	app.RootCmd.PersistentFlags().BoolVar(&indexFallback, "indexFallback", true, "fallback the request to index.html on missing static path, e.g. when pretty urls are used with SPA")

	app.RootCmd.ParseFlags(os.Args[1:])

	jsvm.MustRegister(app, jsvm.Config{
		MigrationsDir: migrationsDir,
		HooksDir:      hooksDir,
		HooksWatch:    hooksWatch,
		HooksPoolSize: hooksPool,
	})

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		TemplateLang: migratecmd.TemplateLangJS,
		Automigrate:  automigrate,
		Dir:          migrationsDir,
	})

	registerPush(app)

	// Files that must never be stored by Cloudflare or the browser, or phones keep running an old
	// service worker (the one that shows notifications) for hours after an update.
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.BindFunc(func(e *core.RequestEvent) error {
			switch e.Request.URL.Path {
			case "/", "/index.html", "/sw.js", "/manifest.webmanifest":
				e.Response.Header().Set("Cache-Control", "no-cache")
			}
			return e.Next()
		})
		return se.Next()
	})

	app.OnServe().Bind(&hook.Handler[*core.ServeEvent]{
		Func: func(e *core.ServeEvent) error {
			if !e.Router.HasRoute(http.MethodGet, "/{path...}") {
				e.Router.GET("/{path...}", apis.Static(os.DirFS(publicDir), indexFallback))
			}
			return e.Next()
		},
		Priority: 999,
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

// the default pb_public dir location is relative to the executable
func defaultPublicDir() string {
	if osutils.IsProbablyGoRun() {
		return "./pb_public"
	}
	return filepath.Join(os.Args[0], "../pb_public")
}
