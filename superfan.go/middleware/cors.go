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
	allowed := parseAllowedOrigins(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if len(allowed) == 0 {
		allowed = []string{
			"http://localhost:9090",
			"http://localhost:3000",
			"http://localhost:3001",
			"http://127.0.0.1:9090",
			"http://127.0.0.1:3000",
		}
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
