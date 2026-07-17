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

	protected := quizroute.Group("")
	protected.Use(middleware.AuthRequired())
	{
		protected.POST("/live", qc.CreateLiveQuiz)
		protected.PATCH("/live/:id", qc.UpdateLiveQuiz)
		protected.PUT("/live/:id", qc.UpdateLiveQuiz)
		protected.DELETE("/live/:id", qc.DeleteLiveQuiz)
	}
}
