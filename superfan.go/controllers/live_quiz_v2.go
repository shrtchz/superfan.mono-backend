package controllers

import (
	"github.com/gin-gonic/gin"
	"quiz.superfan.com/apis/middleware"
)

// RegisterLiveQuizV2Routes mounts live quiz content CRUD under /v2/quiz/live*.
func RegisterLiveQuizV2Routes(rg *gin.RouterGroup, qc *QuizController) {
	quizroute := rg.Group("/quiz")

	protected := quizroute.Group("")
	protected.Use(middleware.AuthRequired())
	{
		protected.POST("/live", qc.CreateLiveQuiz)
		protected.GET("/live", qc.GetAllLiveQuiz)
		protected.GET("/live/random/:number", qc.GetRandomLiveQuiz)
		protected.GET("/live/:id", qc.GetLiveQuiz)
		protected.GET("/live-answer/:id", qc.GetLiveQuizAnswerById)
		protected.PATCH("/live/:id", qc.UpdateLiveQuiz)
		protected.PUT("/live/:id", qc.UpdateLiveQuiz)
		protected.DELETE("/live/:id", qc.DeleteLiveQuiz)
	}
}
