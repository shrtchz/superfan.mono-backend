package middleware

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORSMiddleware allows browser clients (admin/client) to call Go directly.
// Handles OPTIONS preflight before AuthRequired runs.
func CORSMiddleware() gin.HandlerFunc {
	defaultAllowed := []string{
		"http://localhost:9090",
		"http://localhost:9050",
		"http://localhost:3000",
		"http://127.0.0.1:9090",
		"http://127.0.0.1:9050",
		"http://127.0.0.1:3000",
		"https://api.superfan.ng",
		"https://superfan-admin.vercel.app",
		"https://superfan-client.vercel.app",
		"https://sn1.superfan.ng",
		"https://s1.superfan.ng",
		"https://sg1.superfan.ng",
		"https://sa1.superfan.ng",
		"https://sq1.superfan.ng",
	}

	allowed := parseAllowedOrigins(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if len(allowed) == 0 {
		allowed = defaultAllowed
	} else {
		allowed = mergeOrigins(allowed, defaultAllowed)
	}

	allowAll := false
	for _, o := range allowed {
		if o == "*" {
			allowAll = true
			break
		}
	}

	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if origin != "" && (allowAll || originAllowed(origin, allowed)) {
			if allowAll {
				c.Header("Access-Control-Allow-Origin", "*")
			} else {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
				c.Header("Access-Control-Allow-Credentials", "true")
			}
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Client-Info, Accept, Origin")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Max-Age", "86400")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

func parseAllowedOrigins(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, strings.TrimRight(p, "/"))
		}
	}
	return out
}

func originAllowed(origin string, allowed []string) bool {
	origin = strings.TrimRight(origin, "/")
	for _, a := range allowed {
		if strings.EqualFold(a, origin) {
			return true
		}
	}
	return false
}

func mergeOrigins(primary []string, fallback []string) []string {
	seen := make(map[string]struct{}, len(primary)+len(fallback))
	out := make([]string, 0, len(primary)+len(fallback))

	push := func(origin string) {
		normalized := strings.TrimRight(strings.TrimSpace(origin), "/")
		if normalized == "" {
			return
		}
		key := strings.ToLower(normalized)
		if _, exists := seen[key]; exists {
			return
		}
		seen[key] = struct{}{}
		out = append(out, normalized)
	}

	for _, origin := range primary {
		push(origin)
	}
	for _, origin := range fallback {
		push(origin)
	}

	return out
}
