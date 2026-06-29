package utils

import (
	"time"

	"github.com/gin-gonic/gin"
)

// SuccessResponse defines the standard success payload
type SuccessResponse struct {
	Success   bool        `json:"success"`
	Message   string      `json:"message,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Timestamp string      `json:"timestamp"`
}

// ErrorDetail defines the specific error information
type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ErrorResponse defines the standard error payload
type ErrorResponse struct {
	Success   bool        `json:"success"`
	Error     ErrorDetail `json:"error"`
	Timestamp string      `json:"timestamp"`
}

// Success sends a standard success JSON response
func Success(c *gin.Context, statusCode int, message string, data interface{}) {
	c.JSON(statusCode, SuccessResponse{
		Success:   true,
		Message:   message,
		Data:      data,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

// SendError sends a standard error JSON response
func SendError(c *gin.Context, statusCode int, code string, message string) {
	c.JSON(statusCode, ErrorResponse{
		Success:   false,
		Error: ErrorDetail{
			Code:    code,
			Message: message,
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}
