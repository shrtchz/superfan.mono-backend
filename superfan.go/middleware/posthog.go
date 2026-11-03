package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
	"quiz.superfan.com/apis/utils"
)

// PostHogMiddleware tracks incoming requests in PostHog.
func PostHogMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		if utils.PostHogClient == nil {
			return
		}

		status := c.Writer.Status()

		// Identify distinct ID (from user auth if available, otherwise IP or Anonymous)
		distinctID := ""
		if val, exists := c.Get("userId"); exists {
			if idStr, ok := val.(string); ok && idStr != "" {
				distinctID = idStr
			}
		}
		if distinctID == "" {
			if val, exists := c.Get("user_id"); exists {
				if idStr, ok := val.(string); ok && idStr != "" {
					distinctID = idStr
				}
			}
		}
		if distinctID == "" {
			distinctID = c.ClientIP()
		}

		duration := time.Since(start).Milliseconds()

		properties := map[string]interface{}{
			"$current_url": c.Request.URL.Path,
			"method":       c.Request.Method,
			"status_code":  status,
			"duration_ms":  duration,
			"ip":           c.ClientIP(),
			"user_agent":   c.Request.UserAgent(),
		}

		if len(c.Errors) > 0 {
			properties["errors"] = c.Errors.String()
		}

		utils.TrackEvent(distinctID, "api_request", properties)
	}
}
