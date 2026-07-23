package controllers

import (
	"github.com/gin-gonic/gin"
	"quiz.superfan.com/apis/middleware"
)

// RegisterLiveQuizV2Routes mounts live quiz content CRUD under /v2/quiz/live*.
func RegisterLiveQuizV2Routes(rg *gin.RouterGroup, qc *QuizController) {
	quizroute := rg.Group("/quiz")

	// Public reads — stream player polling, no Clerk JWT required.
	quizroute.GET("/live", qc.GetAllLiveQuiz)
	quizroute.GET("/live/random/:number", qc.GetRandomLiveQuiz)
	quizroute.GET("/live/:id", qc.GetLiveQuiz)
	quizroute.GET("/live-answer/:id", qc.GetLiveQuizAnswerById)

	// Live quiz answer submission requires auth and is routed through Go.
	quizroute.POST("/live/:id/answer", middleware.AuthRequired(), qc.SubmitLiveQuizAnswer)

	// Make POST/PATCH/PUT/DELETE public for live quizzes (no auth middleware)
	quizroute.POST("/live", qc.CreateLiveQuiz)
	quizroute.PATCH("/live/:id", qc.UpdateLiveQuiz)
	quizroute.PUT("/live/:id", qc.UpdateLiveQuiz)
	quizroute.DELETE("/live/:id", qc.DeleteLiveQuiz)
	quizroute.PATCH("/live/:id/custom-countdown-label", qc.UpdateLiveQuizCustomCountdownLabel)
	quizroute.DELETE("/live/:id/custom-countdown-label", qc.DeleteLiveQuizCustomCountdownLabel)
}
