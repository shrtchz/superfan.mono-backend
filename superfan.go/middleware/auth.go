package middleware

import (
	"net/http"
	"strings"

	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services"
	"quiz.superfan.com/apis/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	ContextUserIDKey    = "authUserId"
	ContextUserEmailKey = "authUserEmail"
	ContextUserRoleKey  = "authUserRole"
	ContextAuthSource   = "authSource"
)

// AuthRequired accepts only Clerk session JWTs (Bearer header, __session cookie, or ?token=).
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractBearerToken(c.GetHeader("Authorization"))
		if token == "" {
			if cookie, err := c.Cookie("__session"); err == nil {
				token = strings.TrimSpace(cookie)
			}
		}
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
				"error": "Invalid token value. Expected a Clerk session JWT.",
			})
			return
		}
		if strings.HasPrefix(token, "sit_") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid token type: Clerk sign-in token cannot be used for protected routes. Use a Clerk session JWT.",
			})
			return
		}

		claims, ok := verifyClerkToken(token)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid token. Use a Clerk session JWT.",
				"code":  "INVALID_CLERK_TOKEN",
			})
			return
		}

		sub, _ := claims["sub"].(string)
		email, _ := claims["email"].(string)

		localUserID, err := services.ResolveLocalUserID(sub, email)
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
					"error":   "User not provisioned. Call POST /user/sync first.",
					"code":    "USER_NOT_PROVISIONED",
					"clerkId": sub,
				})
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to resolve user identity",
			})
			return
		}

		c.Set(ContextUserIDKey, localUserID)
		if email != "" {
			c.Set(ContextUserEmailKey, email)
		}
		c.Set(ContextAuthSource, "clerk")
		c.Next()
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

// OptionalAuth accepts Clerk session JWTs if provided, but does not require auth.
func OptionalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractBearerToken(c.GetHeader("Authorization"))
		if token == "" {
			if cookie, err := c.Cookie("__session"); err == nil {
				token = strings.TrimSpace(cookie)
			}
		}
		if token == "" {
			token = strings.TrimSpace(c.Query("token"))
		}

		if token == "" {
			c.Next()
			return
		}
		if token == "undefined" || token == "null" {
			c.Next()
			return
		}
		if strings.HasPrefix(token, "sit_") {
			c.Next()
			return
		}

		claims, ok := verifyClerkToken(token)
		if !ok {
			c.Next()
			return
		}

		sub, _ := claims["sub"].(string)
		email, _ := claims["email"].(string)
		localUserID, err := services.ResolveLocalUserID(sub, email)
		if err != nil {
			c.Next()
			return
		}

		c.Set(ContextUserIDKey, localUserID)
		if email != "" {
			c.Set(ContextUserEmailKey, email)
		}
		c.Set(ContextAuthSource, "clerk")
		c.Next()
	}
}

// IsAdmin returns true if the current context user has an administrator role (superadmin, subadmin, or admin).
func IsAdmin(c *gin.Context) bool {
	if roleVal, exists := c.Get(ContextUserRoleKey); exists {
		if role, ok := roleVal.(string); ok {
			roleLower := strings.ToLower(strings.TrimSpace(role))
			if roleLower == "superadmin" || roleLower == "subadmin" || roleLower == "admin" {
				return true
			}
		}
	}

	userID := c.GetInt(ContextUserIDKey)
	if userID <= 0 {
		return false
	}

	if utils.DB == nil {
		return false
	}

	var user models.User
	if err := utils.DB.WithContext(c.Request.Context()).Select("roleName").First(&user, userID).Error; err != nil {
		return false
	}

	roleName := ""
	if user.RoleName != nil {
		roleName = strings.ToLower(strings.TrimSpace(*user.RoleName))
		c.Set(ContextUserRoleKey, roleName)
	}

	return roleName == "superadmin" || roleName == "subadmin" || roleName == "admin"
}

// AdminRequired ensures that the request is authenticated and performed by an administrator.
func AdminRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !IsAdmin(c) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "Forbidden: Administrator access required",
				"code":  "FORBIDDEN",
			})
			return
		}
		c.Next()
	}
}
