// Web Push: every in-app notification (a record in "notifications") is also sent to the
// phones and computers where that person turned notifications on.
//
// Routes:
//   GET  /api/ch/push/key          public VAPID key the browser needs to subscribe
//   POST /api/ch/push/subscribe    save this device for the signed-in person
//   POST /api/ch/push/unsubscribe  forget this device (on sign-out or when turned off)
//   POST /api/ch/push/test         send a test notification to the signed-in person
//
// The VAPID key pair is created once and kept in pb_data/vapid.json.
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const subsCollection = "push_subscriptions"

// At most this many devices per person; the oldest are forgotten first.
const maxDevicesPerUser = 10

type vapidKeys struct {
	Public  string `json:"public"`
	Private string `json:"private"`
}

type pushMessage struct {
	Title string `json:"title"`
	Body  string `json:"body,omitempty"`
	URL   string `json:"url,omitempty"`
	Tag   string `json:"tag,omitempty"`
	Badge int    `json:"badge"`
}

type pusher struct {
	app     core.App
	keys    vapidKeys
	contact string
	client  *http.Client
	slots   chan struct{} // limits parallel sends so a big schedule publish can't swamp the Pi
}

var activePusher atomic.Pointer[pusher]

func registerPush(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		keys, err := loadOrCreateVAPID(se.App.DataDir())
		if err != nil {
			return err
		}
		p := &pusher{
			app:     se.App,
			keys:    keys,
			contact: pushContact(se.App),
			client: &http.Client{
				Timeout: 20 * time.Second,
				// Push services answer directly; never follow a redirect somewhere else.
				CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
			},
			slots: make(chan struct{}, 4),
		}
		activePusher.Store(p)

		se.Router.GET("/api/ch/push/key", func(e *core.RequestEvent) error {
			return e.JSON(http.StatusOK, map[string]string{"key": p.keys.Public})
		})
		se.Router.POST("/api/ch/push/subscribe", p.handleSubscribe).Bind(apis.RequireAuth("users"))
		se.Router.POST("/api/ch/push/unsubscribe", p.handleUnsubscribe).Bind(apis.RequireAuth("users"))
		se.Router.POST("/api/ch/push/test", p.handleTest).Bind(apis.RequireAuth("users"))
		return se.Next()
	})

	// Runs after the notification is saved (after the transaction commits, if there is one).
	app.OnRecordAfterCreateSuccess("notifications").BindFunc(func(e *core.RecordEvent) error {
		if p := activePusher.Load(); p != nil {
			userID := e.Record.GetString("user")
			msg := pushMessage{
				Title: e.Record.GetString("title"),
				Body:  e.Record.GetString("body"),
				URL:   e.Record.GetString("link"),
				Tag:   e.Record.Id,
			}
			go p.inBackground(func() { p.sendToUser(userID, msg) })
		}
		return e.Next()
	})
}

func (p *pusher) inBackground(f func()) {
	p.slots <- struct{}{}
	defer func() {
		<-p.slots
		if r := recover(); r != nil {
			p.app.Logger().Error("push: panic while sending", "error", r)
		}
	}()
	f()
}

// ---------- routes ----------

type subscribeBody struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

func (p *pusher) handleSubscribe(e *core.RequestEvent) error {
	if !e.Auth.GetBool("active") {
		return e.ForbiddenError("This account is turned off.", nil)
	}
	var b subscribeBody
	if err := e.BindBody(&b); err != nil {
		return e.BadRequestError("Invalid request.", err)
	}
	if !allowedEndpoint(b.Endpoint) || len(b.Endpoint) > 1000 {
		return e.BadRequestError("This browser can't receive notifications from Crewdeck.", nil)
	}
	if !validKey(b.Keys.P256dh, 65) || !validKey(b.Keys.Auth, 16) {
		return e.BadRequestError("Invalid notification keys.", nil)
	}

	col, err := e.App.FindCollectionByNameOrId(subsCollection)
	if err != nil {
		return e.InternalServerError("", err)
	}
	rec, _ := e.App.FindFirstRecordByFilter(subsCollection, "endpoint = {:e}", dbx.Params{"e": b.Endpoint})
	if rec == nil {
		rec = core.NewRecord(col)
		rec.Set("endpoint", b.Endpoint)
	}
	// The same device may now belong to someone else (they signed in on it): it follows the new person.
	rec.Set("user", e.Auth.Id)
	rec.Set("p256dh", b.Keys.P256dh)
	rec.Set("auth", b.Keys.Auth)
	rec.Set("ua", truncate(e.Request.UserAgent(), 300))
	if err := e.App.Save(rec); err != nil {
		return e.BadRequestError("Couldn't save this device.", err)
	}

	if subs, err := e.App.FindRecordsByFilter(subsCollection, "user = {:u}", "-updated", 0, 0, dbx.Params{"u": e.Auth.Id}); err == nil {
		for i, s := range subs {
			if i >= maxDevicesPerUser {
				_ = e.App.Delete(s)
			}
		}
	}
	return e.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func (p *pusher) handleUnsubscribe(e *core.RequestEvent) error {
	var b struct {
		Endpoint string `json:"endpoint"`
	}
	if err := e.BindBody(&b); err != nil || b.Endpoint == "" {
		return e.BadRequestError("Invalid request.", err)
	}
	if rec, _ := e.App.FindFirstRecordByFilter(subsCollection, "endpoint = {:e} && user = {:u}", dbx.Params{"e": b.Endpoint, "u": e.Auth.Id}); rec != nil {
		if err := e.App.Delete(rec); err != nil {
			return e.InternalServerError("", err)
		}
	}
	return e.JSON(http.StatusOK, map[string]bool{"ok": true})
}

func (p *pusher) handleTest(e *core.RequestEvent) error {
	sent, failed := p.sendToUser(e.Auth.Id, pushMessage{
		Title: "Notifications are on",
		Body:  "This is how Crewdeck will tell you about shifts and requests.",
		URL:   "#/today",
		Tag:   "crewdeck-test",
	})
	return e.JSON(http.StatusOK, map[string]int{"sent": sent, "failed": failed})
}

// ---------- sending ----------

func (p *pusher) sendToUser(userID string, msg pushMessage) (sent, failed int) {
	user, err := p.app.FindRecordById("users", userID)
	if err != nil || !user.GetBool("active") {
		return 0, 0
	}
	subs, err := p.app.FindRecordsByFilter(subsCollection, "user = {:u}", "-updated", maxDevicesPerUser, 0, dbx.Params{"u": userID})
	if err != nil || len(subs) == 0 {
		return 0, 0
	}
	if n, err := p.app.CountRecords("notifications", dbx.HashExp{"user": userID, "read": false}); err == nil {
		msg.Badge = int(n)
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		return 0, 0
	}
	for _, s := range subs {
		ok, gone := p.send(payload, s)
		if ok {
			sent++
		} else {
			failed++
		}
		if gone {
			if err := p.app.Delete(s); err != nil {
				p.app.Logger().Warn("push: couldn't forget an expired device", "error", err)
			}
		}
	}
	return sent, failed
}

// send delivers one message to one device. gone = the device unsubscribed and should be forgotten.
func (p *pusher) send(payload []byte, s *core.Record) (ok, gone bool) {
	endpoint := s.GetString("endpoint")
	if !allowedEndpoint(endpoint) {
		return false, true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: endpoint,
		Keys:     webpush.Keys{P256dh: s.GetString("p256dh"), Auth: s.GetString("auth")},
	}, &webpush.Options{
		HTTPClient:      p.client,
		Subscriber:      p.contact,
		VAPIDPublicKey:  p.keys.Public,
		VAPIDPrivateKey: p.keys.Private,
		TTL:             24 * 3600,
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		p.app.Logger().Warn("push: send failed", "host", hostOf(endpoint), "error", err)
		return false, false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return true, false
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return false, true
	default:
		p.app.Logger().Warn("push: rejected", "host", hostOf(endpoint), "status", resp.StatusCode, "body", truncate(string(body), 300))
		return false, false
	}
}

// ---------- helpers ----------

// Only the real push services of Apple, Google, Mozilla and Microsoft. Anything else is refused,
// so a signed-in user can't make the server send requests to other machines (like other apps on the Pi).
func allowedEndpoint(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Host == "" {
		return false
	}
	// Used only by the automatic backend test, which runs a fake push service locally.
	if test := os.Getenv("CREWDECK_PUSH_TEST_HOST"); test != "" && u.Host == test && (u.Scheme == "http" || u.Scheme == "https") {
		return true
	}
	if u.Scheme != "https" || (u.Port() != "" && u.Port() != "443") {
		return false
	}
	h := strings.ToLower(u.Hostname())
	switch {
	case h == "fcm.googleapis.com", h == "android.googleapis.com", h == "web.push.apple.com":
		return true
	case strings.HasSuffix(h, ".push.apple.com"), strings.HasSuffix(h, ".push.services.mozilla.com"), strings.HasSuffix(h, ".notify.windows.com"):
		return true
	}
	return false
}

func validKey(s string, size int) bool {
	s = strings.TrimRight(s, "=")
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		b, err = base64.RawStdEncoding.DecodeString(s)
	}
	return err == nil && len(b) == size
}

// The "sub" in the VAPID token: who runs this server. Push services require https: or mailto:.
func pushContact(app core.App) string {
	if c := strings.TrimSpace(os.Getenv("CREWDECK_PUSH_CONTACT")); c != "" {
		return strings.TrimPrefix(c, "mailto:") // the library adds "mailto:" itself when needed
	}
	for _, o := range strings.Split(os.Getenv("CREWDECK_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); strings.HasPrefix(o, "https://") {
			return o
		}
	}
	if u := app.Settings().Meta.AppURL; strings.HasPrefix(u, "https://") {
		return u
	}
	return "admin@localhost"
}

func loadOrCreateVAPID(dataDir string) (vapidKeys, error) {
	path := filepath.Join(dataDir, "vapid.json")
	var k vapidKeys
	if b, err := os.ReadFile(path); err == nil {
		if json.Unmarshal(b, &k) == nil && k.Public != "" && k.Private != "" {
			return k, nil
		}
		return k, errors.New("push: " + path + " is damaged; delete it to create new keys (devices will need to turn notifications on again)")
	}
	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return k, err
	}
	k = vapidKeys{Public: pub, Private: priv}
	b, _ := json.MarshalIndent(k, "", "  ")
	if err := os.WriteFile(path, b, 0o600); err != nil {
		return k, err
	}
	return k, nil
}

func hostOf(raw string) string {
	if u, err := url.Parse(raw); err == nil {
		return u.Host
	}
	return ""
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
