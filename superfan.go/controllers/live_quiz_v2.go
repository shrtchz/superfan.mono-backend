package controllers

import (
	"github.com/gin-gonic/gin"
	"quiz.superfan.com/apis/middleware"
)

// RegisterLiveQuizV2Routes mounts live quiz content CRUD under /v2/quiz/live*.
func RegisterLiveQuizV2Routes(rg *gin.RouterGroup, qc *QuizController) {
	// Public / optional-auth live quiz reads (used by AdsPlayer and NestJS stream gateway)
	publicLiveQuiz := rg.Group("/quiz", middleware.OptionalAuth())
	publicLiveQuiz.GET("/live", qc.GetAllLiveQuiz)
	publicLiveQuiz.GET("/live/random/:number", qc.GetRandomLiveQuiz)
	publicLiveQuiz.GET("/live/:id", qc.GetLiveQuiz)

	quizroute := rg.Group("/quiz")
	quizroute.Use(middleware.InternalOrAuthRequired())

	// Authenticated reads & answer submissions
	quizroute.GET("/live-answer/:id", qc.GetLiveQuizAnswerById)
	quizroute.POST("/live/:id/answer", qc.SubmitLiveQuizAnswer)
	quizroute.POST("/live-quiz-answer/:id", qc.SubmitLiveQuizAnswer)

	// Admin-only live quiz writes
	adminOnly := quizroute.Group("", middleware.InternalOrAdminRequired())
	adminOnly.POST("/live", qc.CreateLiveQuiz)
	adminOnly.PATCH("/live/:id", qc.UpdateLiveQuiz)
	adminOnly.PUT("/live/:id", qc.UpdateLiveQuiz)
	adminOnly.DELETE("/live/:id", qc.DeleteLiveQuiz)
	adminOnly.PATCH("/live/:id/custom-countdown-label", qc.UpdateLiveQuizCustomCountdownLabel)
	adminOnly.DELETE("/live/:id/custom-countdown-label", qc.DeleteLiveQuizCustomCountdownLabel)
	adminOnly.POST("/live/:id/custom-countdown-labels", qc.CreateLiveQuizCustomCountdownLabel)
	adminOnly.PATCH("/live/:id/custom-countdown-labels/:labelId", qc.UpdateLiveQuizCustomCountdownLabelByID)
	adminOnly.DELETE("/live/:id/custom-countdown-labels/:labelId", qc.DeleteLiveQuizCustomCountdownLabelByID)
}
