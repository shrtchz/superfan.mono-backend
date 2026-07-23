package controllers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"quiz.superfan.com/apis/middleware"
	"quiz.superfan.com/apis/services"
)

type StreamAPIController struct {
	ytService *services.YouTubeService
}

func NewStreamAPIController() *StreamAPIController {
	return &StreamAPIController{
		ytService: services.NewYouTubeService(),
	}
}

type CreateBroadcastRequest struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
}

// CreateBroadcast endpoint exposes the YouTube API creation logic to NestJS
func (ctrl *StreamAPIController) CreateBroadcast(c *gin.Context) {
	var req CreateBroadcastRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	broadcast, err := ctrl.ytService.CreateBroadcast(c.Request.Context(), req.Title, req.Description)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "token") || strings.Contains(errStr, "oauth2") || strings.Contains(errStr, "credential") || strings.Contains(errStr, "auth") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "YouTube authentication required", "details": errStr})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create broadcast", "details": errStr})
		return
	}

	c.JSON(http.StatusOK, broadcast)
}

type SetupStreamRequest struct {
	BroadcastID string `json:"broadcastId" binding:"required"`
	Title       string `json:"title" binding:"required"`
}

// SetupStream endpoint generates a RTMP stream and binds it
func (ctrl *StreamAPIController) SetupStream(c *gin.Context) {
	var req SetupStreamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	streamRes, err := ctrl.ytService.SetupStream(c.Request.Context(), req.BroadcastID, req.Title)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "token") || strings.Contains(errStr, "oauth2") || strings.Contains(errStr, "credential") || strings.Contains(errStr, "auth") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "YouTube authentication required", "details": errStr})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to setup stream", "details": errStr})
		return
	}

	c.JSON(http.StatusOK, streamRes)
}

type TransitionBroadcastRequest struct {
	BroadcastID string `json:"broadcastId" binding:"required"`
	Status      string `json:"status" binding:"required"` // e.g., "live", "complete"
}

// TransitionBroadcast endpoint handles goLive / endStream
func (ctrl *StreamAPIController) TransitionBroadcast(c *gin.Context) {
	var req TransitionBroadcastRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	broadcast, err := ctrl.ytService.TransitionBroadcast(c.Request.Context(), req.BroadcastID, req.Status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to transition broadcast", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, broadcast)
}

// GetVideoViews endpoint handles fetching YouTube video stats
func (ctrl *StreamAPIController) GetVideoViews(c *gin.Context) {
	videoID := c.Query("videoId")
	if videoID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "videoId query parameter is required"})
		return
	}

	res, err := ctrl.ytService.GetVideoViews(c.Request.Context(), videoID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch video views", "details": err.Error()})
		return
	}

	c.JSON(http.StatusOK, res)
}

type EnableEmbedRequest struct {
	VideoID string `json:"videoId" binding:"required"`
}

// EnableEmbed forces embedding on an existing YouTube video/broadcast
func (ctrl *StreamAPIController) EnableEmbed(c *gin.Context) {
	var req EnableEmbedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := ctrl.ytService.EnsureEmbeddable(c.Request.Context(), req.VideoID); err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "token") || strings.Contains(errStr, "oauth2") || strings.Contains(errStr, "credential") || strings.Contains(errStr, "auth") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "YouTube authentication required", "details": errStr})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to enable embedding", "details": errStr})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "videoId": req.VideoID})
}

// RegisterStreamRoutes registers the REST endpoints (protected like Nest JwtGuard)
func RegisterStreamRoutes(router *gin.RouterGroup) {
	ctrl := NewStreamAPIController()

	streamGroup := router.Group("/streams")
	streamGroup.Use(middleware.AuthRequired())
	{
		streamGroup.POST("/broadcast", ctrl.CreateBroadcast)
		streamGroup.POST("/setup", ctrl.SetupStream)
		streamGroup.POST("/transition", ctrl.TransitionBroadcast)
		streamGroup.POST("/enable-embed", ctrl.EnableEmbed)
		streamGroup.GET("/views", ctrl.GetVideoViews)
	}
}
