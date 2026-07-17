package controllers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services"
	"quiz.superfan.com/apis/utils"
)

type QuizSessionV2Controller struct {
	service *services.QuizSessionV2Service
}

func NewQuizSessionV2Controller(service *services.QuizSessionV2Service) *QuizSessionV2Controller {
	return &QuizSessionV2Controller{service: service}
}

// CreateSession handles POST /v2/quiz/sessions.
func (c *QuizSessionV2Controller) CreateSession(ctx *gin.Context) {
	var req models.CreateSessionV2Request
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	result, err := c.service.CreateSession(req)
	if err != nil {
		sendServiceError(ctx, err)
		return
	}

	statusCode := http.StatusOK
	message := "You already have an ongoing quiz"
	if result.Created {
		statusCode = http.StatusCreated
		message = "Quiz session created"
	} else if result.Session.Status == "expired" {
		message = "Ongoing quiz session has expired"
	}

	utils.Success(ctx, statusCode, message, gin.H{
		"session":        result.Session,
		"hasOngoingQuiz": result.HasOngoingQuiz,
		"created":        result.Created,
	})
}

// GetSession handles GET /v2/quiz/sessions/:sessionId.
func (c *QuizSessionV2Controller) GetSession(ctx *gin.Context) {
	sessionID := strings.TrimSpace(ctx.Param("sessionId"))
	userID, err := parseRequiredUserID(ctx.Query("userId"))
	if err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	session, err := c.service.GetSession(sessionID, userID)
	if err != nil {
		sendServiceError(ctx, err)
		return
	}

	message := "Quiz session fetched"
	if session.Status == "expired" {
		message = "Quiz session has expired"
	}

	utils.Success(ctx, http.StatusOK, message, gin.H{
		"session": session,
	})
}

// BeginSession handles PATCH /v2/quiz/sessions/:sessionId/begin.
func (c *QuizSessionV2Controller) BeginSession(ctx *gin.Context) {
	sessionID := strings.TrimSpace(ctx.Param("sessionId"))

	var req models.BeginSessionV2Request
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	session, err := c.service.BeginSession(sessionID, req.UserID)
	if err != nil {
		sendServiceError(ctx, err)
		return
	}

	utils.Success(ctx, http.StatusOK, "Quiz session started", gin.H{
		"session": session,
	})
}

// SaveAnswer handles PATCH /v2/quiz/sessions/:sessionId/answers.
func (c *QuizSessionV2Controller) SaveAnswer(ctx *gin.Context) {
	sessionID := strings.TrimSpace(ctx.Param("sessionId"))

	var req models.SaveAnswerV2Request
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	result, err := c.service.SaveAnswer(sessionID, req)
	if err != nil {
		sendServiceError(ctx, err)
		return
	}

	utils.Success(ctx, http.StatusOK, "Answer saved", gin.H{
		"answer":  result.Answer,
		"session": result.Session,
	})
}

// SubmitSession handles POST /v2/quiz/sessions/:sessionId/submit.
func (c *QuizSessionV2Controller) SubmitSession(ctx *gin.Context) {
	sessionID := strings.TrimSpace(ctx.Param("sessionId"))

	var req models.FinalizeSessionV2Request
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	result, err := c.service.SubmitSession(sessionID, req)
	if err != nil {
		sendServiceError(ctx, err)
		return
	}

	utils.Success(ctx, http.StatusOK, "Quiz submitted successfully", gin.H{
		"result":    result.Result,
		"responses": result.Responses,
		"streak":    result.Streak,
		"session":   result.Session,
		"submitted": result.Submitted,
	})
}

// QuitSession handles POST /v2/quiz/sessions/:sessionId/quit.
func (c *QuizSessionV2Controller) QuitSession(ctx *gin.Context) {
	sessionID := strings.TrimSpace(ctx.Param("sessionId"))

	var req models.FinalizeSessionV2Request
	if err := ctx.ShouldBindJSON(&req); err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	result, err := c.service.QuitSession(sessionID, req)
	if err != nil {
		sendServiceError(ctx, err)
		return
	}

	message := "Quiz has been quit successfully"
	if result.Result == nil && !result.Submitted {
		message = "Quiz ended with no answers"
	}

	utils.Success(ctx, http.StatusOK, message, gin.H{
		"result":    result.Result,
		"responses": result.Responses,
		"streak":    result.Streak,
		"session":   result.Session,
		"submitted": result.Submitted,
	})
}

func parseRequiredUserID(raw string) (int, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, errors.New("userId query parameter is required")
	}

	userID, err := strconv.Atoi(trimmed)
	if err != nil || userID <= 0 {
		return 0, errors.New("userId must be a positive integer")
	}

	return userID, nil
}

func sendServiceError(ctx *gin.Context, err error) {
	var appErr *utils.AppError
	if errors.As(err, &appErr) {
		utils.SendError(ctx, appErr.Status, appErr.Code, appErr.Message)
		return
	}

	utils.SendError(ctx, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
}

func RegisterQuizSessionV2Routes(rg *gin.RouterGroup, quizService services.QuizService) {
	controller := NewQuizSessionV2Controller(services.NewQuizSessionV2Service(quizService))

	sessions := rg.Group("/quiz/sessions")
	{
		sessions.POST("", controller.CreateSession)
		sessions.GET("/:sessionId", controller.GetSession)
		sessions.PATCH("/:sessionId/begin", controller.BeginSession)
		sessions.PATCH("/:sessionId/answers", controller.SaveAnswer)
		sessions.POST("/:sessionId/submit", controller.SubmitSession)
		sessions.POST("/:sessionId/quit", controller.QuitSession)
	}
}
