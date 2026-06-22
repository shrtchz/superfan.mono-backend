package controllers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services"
	"quiz.superfan.com/apis/utils"
)

type QuizController struct {
	QuizService services.QuizService
}

type QuizSubmissionController struct {
	service *services.QuizServiceImpl
}

func NewQuizController(quizService services.QuizService) *QuizController {
	return &QuizController{QuizService: quizService}
}

func NewQuizSubmissionController(service *services.QuizServiceImpl) *QuizSubmissionController {
	return &QuizSubmissionController{
		service: service,
	}
}

func New(quizservice services.QuizService) QuizController {
	return QuizController{
		QuizService: quizservice,
	}
}

func (qc *QuizController) CreateQuiz(ctx *gin.Context) {
	var quiz models.Quiz
	if err := ctx.ShouldBindJSON(&quiz); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	err := qc.QuizService.CreateQuiz(&quiz)
	if err != nil {
		ctx.JSON(http.StatusBadGateway, gin.H{"message": err.Error()})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"message": "success"})
}

func (qc *QuizController) CreateQuizCategory(ctx *gin.Context) {
	var category models.QuizCategory
	if err := ctx.ShouldBindJSON(&category); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}

	quiz, err := qc.QuizService.CreateQuizCategory(&category)
	if err != nil {
		ctx.JSON(http.StatusBadGateway, gin.H{"message": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"message": "success", "data": quiz})
}

// GET ALL LIVE QUIZZES
func (qc *QuizController) GetAllCategory(c *gin.Context) {
	categories, err := qc.QuizService.GetAllCategory()
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": categories,
	})
}

func (qc *QuizController) GetCategoryById(ctx *gin.Context) {
	id := ctx.Param("id")

	category, err := qc.QuizService.GetCategoryById(id)
	if err != nil {
		ctx.JSON(http.StatusBadGateway, gin.H{"message": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, category)
}

func (qc *QuizController) GetQuiz(ctx *gin.Context) {
	id := ctx.Param("id")

	quiz, err := qc.QuizService.GetQuiz(id)
	if err != nil {
		ctx.JSON(http.StatusBadGateway, gin.H{"message": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, quiz)
}

func (qc *QuizController) GetAllQuiz(ctx *gin.Context) {
	quizzes, err := qc.QuizService.GetAllQuiz()
	if err != nil {
		ctx.JSON(http.StatusBadGateway, gin.H{"message": err.Error()})
		return
	}
	ctx.JSON(http.StatusOK, quizzes)
}


type QuizPreferencesRequest struct {
	LanguagePreference string `form:"languagePreference" validate:"omitempty"`
	SubjectPreference  string `form:"subjectPreference" validate:"omitempty"`
	TestLevel          string `form:"testLevel" validate:"omitempty"`
	QuestionPreference string `form:"questionPreference" validate:"omitempty"`
	TimePreference     string `form:"timePreference" validate:"omitempty"`
}

func (qc *QuizController) GetQuizByPreferences(ctx *gin.Context) {
	var req QuizPreferencesRequest

	if err := ctx.ShouldBindQuery(&req); err != nil {
		ctx.Error(utils.NewAppError(http.StatusBadRequest, "INVALID_REQUEST", err.Error()))
		ctx.Abort()
		return
	}

	quizzes, err := qc.QuizService.GetQuizByPreferences(
		req.LanguagePreference,
		req.SubjectPreference,
		req.TestLevel,
		req.QuestionPreference,
		req.TimePreference,
	)

	if err != nil {
		ctx.Error(err) // service already returns *AppError (after fix below)
		ctx.Abort()
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data":    quizzes,
	})
}

func (qc *QuizController) SubmitQuiz(ctx *gin.Context) {

	var request models.SubmitQuizRequest

	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	response, err := qc.QuizService.SubmitQuiz(request)

	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Quiz submitted successfully",
		"data":    response,
	})
}

func (c *QuizSubmissionController) GetUserSubmissions(ctx *gin.Context) {
	userID := ctx.Param("userId")

	submissions, err := c.service.GetUserSubmissions(userID)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"success":     true,
		"count":       len(submissions),
		"submissions": submissions,
	})
}

func (c *QuizSubmissionController) GetAllSubmissions(ctx *gin.Context) {
	submissions, err := c.service.GetAllSubmissions()
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{
			"error": err.Error(),
		})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"message":     "success",
		"count":       len(submissions),
		"submissions": submissions,
	})
}

func (qc *QuizController) GetQuizAnswerById(ctx *gin.Context) {

	id := ctx.Param("id")
	if id == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"error": "quiz id is required",
		})
		return
	}

	answer, err := qc.QuizService.GetQuizAnswerById(id)
	if err != nil {
		status := http.StatusInternalServerError

		if err.Error() == "invalid quiz id" || err.Error() == "quiz not found" {
			status = http.StatusBadRequest
		}

		ctx.JSON(status, gin.H{
			"error": err.Error(),
		})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data":    answer,
	})
}

func (qc *QuizController) GetLiveQuizAnswerById(ctx *gin.Context) {

	id := ctx.Param("id")
	if id == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"error": "live quiz id is required",
		})
		return
	}

	answer, err := qc.QuizService.GetLiveQuizAnswerById(id)
	if err != nil {

		status := http.StatusInternalServerError

		if err.Error() == "invalid live quiz id" ||
			err.Error() == "live quiz not found" {

			status = http.StatusBadRequest
		}

		ctx.JSON(status, gin.H{
			"error": err.Error(),
		})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data":    answer,
	})
}

func (qc *QuizController) UpdateQuiz(ctx *gin.Context) {
	id := ctx.Param("id")

	objID, err := bson.ObjectIDFromHex(id)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"message": "invalid id"})
		return
	}

	var quiz models.Quiz
	if err := ctx.ShouldBindJSON(&quiz); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	quiz.ID = objID

	if err := qc.QuizService.UpdateQuiz(&quiz); err != nil {
		ctx.JSON(http.StatusBadGateway, gin.H{"message": err.Error()})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"message": "success"})
}

// CREATE LIVE QUIZ
func (qc *QuizController) CreateLiveQuiz(c *gin.Context) {
	var liveQuiz models.LiveQuiz

	if err := c.ShouldBindJSON(&liveQuiz); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	err := qc.QuizService.CreateLiveQuiz(&liveQuiz)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "live quiz created successfully",
		"data":    liveQuiz,
	})
}

// GET SINGLE LIVE QUIZ
func (qc *QuizController) GetLiveQuiz(c *gin.Context) {
	id := c.Param("id")

	liveQuiz, err := qc.QuizService.GetLiveQuiz(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": liveQuiz,
	})
}

func (q *QuizController) GetRandomLiveQuiz(c *gin.Context) {
	number := c.Param("number")

	quizzes, err := q.QuizService.GetRandomLiveQuiz(number)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": quizzes,
	})
}

// GET ALL LIVE QUIZZES
func (qc *QuizController) GetAllLiveQuiz(c *gin.Context) {
	liveQuizzes, err := qc.QuizService.GetAllLiveQuiz()
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": liveQuizzes,
	})
}

// DELETE LIVE QUIZ
func (qc *QuizController) DeleteLiveQuiz(c *gin.Context) {
	id := c.Param("id")

	err := qc.QuizService.DeleteLiveQuiz(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "live quiz deleted successfully",
	})
}

// UPDATE LIVE QUIZ
func (qc *QuizController) UpdateLiveQuiz(c *gin.Context) {
	id := c.Param("id")

	var liveQuiz models.LiveQuiz

	if err := c.ShouldBindJSON(&liveQuiz); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid id format",
		})
		return
	}

	liveQuiz.ID = objectId

	err = qc.QuizService.UpdateLiveQuiz(&liveQuiz)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "live quiz updated successfully",
	})
}

func (qc *QuizController) DeleteQuiz(ctx *gin.Context) {
	id := ctx.Param("id")

	err := qc.QuizService.DeleteQuiz(id)
	if err != nil {
		ctx.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"message": "quiz deleted successfully"})
}

func RegisterQuizRoutes(
	rg *gin.RouterGroup,
	qc *QuizController,
	qsc *QuizSubmissionController,
) {
	quizroute := rg.Group("/quiz")

	// ── Quiz CRUD ──────────────────────────────────────────
	quizroute.POST("/create", qc.CreateQuiz)
	quizroute.POST("/create-category", qc.CreateQuizCategory)
	quizroute.GET("/categories", qc.GetAllCategory)
	quizroute.GET("/quiz-answer/:id", qc.GetQuizAnswerById)
	quizroute.GET("/get/:id", qc.GetQuiz)
	quizroute.GET("/getall", qc.GetAllQuiz)
	quizroute.PATCH("/update/:id", qc.UpdateQuiz)
	quizroute.DELETE("/delete/:id", qc.DeleteQuiz)

	// ── Preferences & Submission ───────────────────────────
	quizroute.GET("/preferences", qc.GetQuizByPreferences)
	// quizroute.POST("/preferences", qc.GetQuizByPreferences)
	quizroute.POST("/submit", qc.SubmitQuiz)

	// ── Submissions ────────────────────────────────────────
	quizroute.GET("/get-quiz-submissions", qsc.GetAllSubmissions)
	quizroute.GET("/get-user-submissions/:userId", qsc.GetUserSubmissions)

	// ── Live Quiz ──────────────────────────────────────────
	quizroute.POST("/live", qc.CreateLiveQuiz)
	quizroute.GET("/live", qc.GetAllLiveQuiz)
	quizroute.GET("/live/random/:number", qc.GetRandomLiveQuiz)
	quizroute.GET("/live/:id", qc.GetLiveQuiz)
	quizroute.GET("/live-answer/:id", qc.GetLiveQuizAnswerById)
	quizroute.PUT("/live/:id", qc.UpdateLiveQuiz)
	quizroute.DELETE("/live/:id", qc.DeleteLiveQuiz)
}
