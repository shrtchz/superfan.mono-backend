package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"quiz.superfan.com/apis/utils"
)

const (
	ContextUserIDKey    = "authUserId"
	ContextUserEmailKey = "authUserEmail"
	ContextUserRoleKey  = "authUserRole"
	ContextAuthSource   = "authSource"
)

type AppTokenClaims struct {
	ID    any    `json:"id"`
	Email string `json:"email"`
	Role  string `json:"role"`
	jwt.RegisteredClaims
}

// AuthRequired mirrors Nest JwtGuard:
// 1) Authorization: Bearer <token> or __session cookie
// 2) Reject sit_* Clerk sign-in tickets
// 3) Accept app access token signed with AT_SECRET
// 4) Accept Clerk session JWT (verified via Clerk Frontend API JWKS)
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractBearerToken(c.GetHeader("Authorization"))
		if token == "" {
			if cookie, err := c.Cookie("__session"); err == nil {
				token = strings.TrimSpace(cookie)
			}
		}
		// Also allow ?token= for WebSocket clients
		if token == "" {
			token = strings.TrimSpace(c.Query("token"))
		}

		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "No token provided",
			})
			return
		}
		if token == "undefined" || token == "null" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid token value. Expected a Clerk session JWT or app access token.",
			})
			return
		}
		if strings.HasPrefix(token, "sit_") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid token type: Clerk sign-in token cannot be used for protected routes. Use a Clerk session JWT.",
			})
			return
		}

		// 1) App access token (from Nest /auth/login)
		if claims, ok := verifyAppToken(token); ok {
			c.Set(ContextUserIDKey, claims.ID)
			c.Set(ContextUserEmailKey, claims.Email)
			c.Set(ContextUserRoleKey, claims.Role)
			c.Set(ContextAuthSource, "app")
			c.Next()
			return
		}

		// 2) Clerk session JWT
		if claims, ok := verifyClerkToken(token); ok {
			sub, _ := claims["sub"].(string)
			c.Set(ContextUserIDKey, sub)
			if email, ok := claims["email"].(string); ok {
				c.Set(ContextUserEmailKey, email)
			}
			c.Set(ContextAuthSource, "clerk")
			c.Next()
			return
		}

		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid token. Use a Clerk session JWT or the token returned by /auth/login.",
		})
	}
}

func extractBearerToken(authorizationHeader string) string {
	if authorizationHeader == "" {
		return ""
	}
	parts := strings.Fields(strings.TrimSpace(authorizationHeader))
	if len(parts) != 2 {
		return ""
	}
	if !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func verifyAppToken(tokenString string) (*AppTokenClaims, bool) {
	secret := utils.GetEnvWithKey("AT_SECRET")
	if secret == "" {
		secret = "superfan_secret_key"
	}

	claims := &AppTokenClaims{}
	parsed, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if t.Method == nil || t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return []byte(secret), nil
	}, jwt.WithLeeway(5*time.Minute))
	if err != nil || !parsed.Valid {
		return nil, false
	}
	if claims.ID == nil && claims.Email == "" {
		return nil, false
	}
	return claims, true
}
