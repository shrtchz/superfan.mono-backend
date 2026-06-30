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
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	err := qc.QuizService.CreateQuiz(&quiz)
	if err != nil {
		utils.SendError(ctx, http.StatusBadGateway, "BAD_GATEWAY", err.Error())
		return
	}

	// Trigger the 2-way sync to push the new question to Airtable in the background!
	go services.PushToAirtable(&quiz)

	utils.Success(ctx, http.StatusOK, "success", nil)
}

// Airtable Webhook Endpoint
func (qc *QuizController) AirtableWebhook(ctx *gin.Context) {
	// Immediately trigger the background sync
	go services.SyncFromAirtable(qc.QuizService)

	// Return 200 OK instantly so Airtable knows the webhook was received
	utils.Success(ctx, http.StatusOK, "Airtable background sync triggered successfully", nil)
}

func (qc *QuizController) CreateQuizCategory(ctx *gin.Context) {
	var category models.QuizCategory
	if err := ctx.ShouldBindJSON(&category); err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	quiz, err := qc.QuizService.CreateQuizCategory(&category)
	if err != nil {
		utils.SendError(ctx, http.StatusBadGateway, "BAD_GATEWAY", err.Error())
		return
	}

	utils.Success(ctx, http.StatusOK, "success", quiz)
}

// GET ALL LIVE QUIZZES
func (qc *QuizController) GetAllCategory(c *gin.Context) {
	categories, err := qc.QuizService.GetAllCategory()
	if err != nil {
		utils.SendError(c, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "success", categories)
}

func (qc *QuizController) GetCategoryById(ctx *gin.Context) {
	id := ctx.Param("id")

	category, err := qc.QuizService.GetCategoryById(id)
	if err != nil {
		utils.SendError(ctx, http.StatusBadGateway, "BAD_GATEWAY", err.Error())
		return
	}

	utils.Success(ctx, http.StatusOK, "success", category)
}

func (qc *QuizController) GetQuiz(ctx *gin.Context) {
	id := ctx.Param("id")

	quiz, err := qc.QuizService.GetQuiz(id)
	if err != nil {
		utils.SendError(ctx, http.StatusBadGateway, "BAD_GATEWAY", err.Error())
		return
	}

	utils.Success(ctx, http.StatusOK, "success", quiz)
}

func (qc *QuizController) GetAllQuiz(ctx *gin.Context) {
	quizzes, err := qc.QuizService.GetAllQuiz()
	if err != nil {
		utils.SendError(ctx, http.StatusBadGateway, "BAD_GATEWAY", err.Error())
		return
	}
	utils.Success(ctx, http.StatusOK, "success", quizzes)
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
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	response, err := qc.QuizService.SubmitQuiz(request)

	if err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	utils.Success(ctx, http.StatusOK, "Quiz submitted successfully", response)
}

func (c *QuizSubmissionController) GetUserSubmissions(ctx *gin.Context) {
	userID := ctx.Param("userId")

	submissions, err := c.service.GetUserSubmissions(userID)
	if err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	utils.Success(ctx, http.StatusOK, "success", gin.H{
		"count":       len(submissions),
		"submissions": submissions,
	})
}

func (c *QuizSubmissionController) GetAllSubmissions(ctx *gin.Context) {
	submissions, err := c.service.GetAllSubmissions()
	if err != nil {
		utils.SendError(ctx, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(ctx, http.StatusOK, "success", gin.H{
		"count":       len(submissions),
		"submissions": submissions,
	})
}

func (qc *QuizController) GetQuizAnswerById(ctx *gin.Context) {

	id := ctx.Param("id")
	if id == "" {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", "quiz id is required")
		return
	}

	answer, err := qc.QuizService.GetQuizAnswerById(id)
	if err != nil {
		status := http.StatusInternalServerError

		if err.Error() == "invalid quiz id" || err.Error() == "quiz not found" {
			status = http.StatusBadRequest
		}

		utils.SendError(ctx, status, "ERROR", err.Error())
		return
	}

	utils.Success(ctx, http.StatusOK, "success", answer)
}

func (qc *QuizController) GetLiveQuizAnswerById(ctx *gin.Context) {

	id := ctx.Param("id")
	if id == "" {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", "live quiz id is required")
		return
	}

	answer, err := qc.QuizService.GetLiveQuizAnswerById(id)
	if err != nil {

		status := http.StatusInternalServerError

		if err.Error() == "invalid live quiz id" ||
			err.Error() == "live quiz not found" {

			status = http.StatusBadRequest
		}

		utils.SendError(ctx, status, "ERROR", err.Error())
		return
	}

	utils.Success(ctx, http.StatusOK, "success", answer)
}

func (qc *QuizController) UpdateQuiz(ctx *gin.Context) {
	id := ctx.Param("id")

	objID, err := bson.ObjectIDFromHex(id)
	if err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", "invalid id")
		return
	}

	var quiz models.Quiz
	if err := ctx.ShouldBindJSON(&quiz); err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	quiz.ID = objID

	if err := qc.QuizService.UpdateQuiz(&quiz); err != nil {
		utils.SendError(ctx, http.StatusBadGateway, "BAD_GATEWAY", err.Error())
		return
	}
	utils.Success(ctx, http.StatusOK, "success", nil)
}

// CREATE LIVE QUIZ
func (qc *QuizController) CreateLiveQuiz(c *gin.Context) {
	var liveQuiz models.LiveQuiz

	if err := c.ShouldBindJSON(&liveQuiz); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	err := qc.QuizService.CreateLiveQuiz(&liveQuiz)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	utils.Success(c, http.StatusCreated, "live quiz created successfully", liveQuiz)
}

// GET SINGLE LIVE QUIZ
func (qc *QuizController) GetLiveQuiz(c *gin.Context) {
	id := c.Param("id")

	liveQuiz, err := qc.QuizService.GetLiveQuiz(id)
	if err != nil {
		utils.SendError(c, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "success", liveQuiz)
}

func (q *QuizController) GetRandomLiveQuiz(c *gin.Context) {
	number := c.Param("number")

	quizzes, err := q.QuizService.GetRandomLiveQuiz(number)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "success", quizzes)
}

// GET ALL LIVE QUIZZES
func (qc *QuizController) GetAllLiveQuiz(c *gin.Context) {
	liveQuizzes, err := qc.QuizService.GetAllLiveQuiz()
	if err != nil {
		utils.SendError(c, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "success", liveQuizzes)
}

// DELETE LIVE QUIZ
func (qc *QuizController) DeleteLiveQuiz(c *gin.Context) {
	id := c.Param("id")

	err := qc.QuizService.DeleteLiveQuiz(id)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "live quiz deleted successfully", nil)
}

// UPDATE LIVE QUIZ
func (qc *QuizController) UpdateLiveQuiz(c *gin.Context) {
	id := c.Param("id")

	var liveQuiz models.LiveQuiz

	if err := c.ShouldBindJSON(&liveQuiz); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id format")
		return
	}

	liveQuiz.ID = objectId

	err = qc.QuizService.UpdateLiveQuiz(&liveQuiz)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "live quiz updated successfully", nil)
}

func (qc *QuizController) DeleteQuiz(ctx *gin.Context) {
	id := ctx.Param("id")

	err := qc.QuizService.DeleteQuiz(id)
	if err != nil {
		utils.SendError(ctx, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}

	utils.Success(ctx, http.StatusOK, "quiz deleted successfully", nil)
}

func RegisterQuizRoutes(
	rg *gin.RouterGroup,
	qc *QuizController,
	qsc *QuizSubmissionController,
) {
	quizroute := rg.Group("/quiz")

	// Airtable Webhook
	quizroute.POST("/airtable-webhook", qc.AirtableWebhook)

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
