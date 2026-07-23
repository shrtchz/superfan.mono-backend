package controllers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"quiz.superfan.com/apis/middleware"
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

type liveQuizCountdownLabelPayload struct {
	CustomCountdownLabel       string `json:"customCountdownLabel"`
	CustomCountdownLabelBefore string `json:"customCountdownLabelBefore"`
	CustomCountdownLabelDuring string `json:"customCountdownLabelDuring"`
	CustomCountdownLabelAfter  string `json:"customCountdownLabelAfter"`
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

func buildLiveQuizResponse(liveQuiz *models.LiveQuiz) gin.H {
	now := time.Now().UTC()
	status := "scheduled"
	if !liveQuiz.QuizScheduleDate.IsZero() && !liveQuiz.QuizFinishDate.IsZero() {
		status = services.ComputeLiveQuizStatus(liveQuiz.QuizScheduleDate, liveQuiz.QuizFinishDate, now)
	}

	return gin.H{
		"id":                         liveQuiz.IDHex,
		"question":                   liveQuiz.Question,
		"options":                    liveQuiz.Options,
		"answer":                     liveQuiz.Answer,
		"typedAnswer":                liveQuiz.TypedAnswer,
		"isTypedAnswer":              liveQuiz.IsTypedAnswer,
		"customCountdownLabel":       strings.TrimSpace(liveQuiz.CustomCountdownLabel),
		"customCountdownLabelBefore": strings.TrimSpace(liveQuiz.CustomCountdownLabelBefore),
		"customCountdownLabelDuring": strings.TrimSpace(liveQuiz.CustomCountdownLabelDuring),
		"customCountdownLabelAfter":  strings.TrimSpace(liveQuiz.CustomCountdownLabelAfter),
		"jackpotAmount":              liveQuiz.JackpotAmount,
		"totalPrize":                 liveQuiz.TotalPrize,
		"recipients":                 liveQuiz.Recipients,
		"unitPrize":                  liveQuiz.UnitPrize,
		"showAnswer":                 liveQuiz.ShowAnswer,
		"quizScheduleDate":           liveQuiz.QuizScheduleDate.UTC().Format(time.RFC3339),
		"quizFinishDate":             liveQuiz.QuizFinishDate.UTC().Format(time.RFC3339),
		"imageLink":                  liveQuiz.ImageLink,
		"status":                     status,
		"quizCountdownState":         status,
		"quizCountdownLabel": services.BuildLiveQuizCountdownLabel(
			liveQuiz.QuizScheduleDate,
			liveQuiz.QuizFinishDate,
			now,
			strings.TrimSpace(liveQuiz.CustomCountdownLabelBefore),
			strings.TrimSpace(liveQuiz.CustomCountdownLabelDuring),
			strings.TrimSpace(liveQuiz.CustomCountdownLabelAfter),
		),
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

func (qc *QuizController) SearchQuizzes(ctx *gin.Context) {
	q := strings.TrimSpace(ctx.Query("q"))
	limit := 10
	if l := strings.TrimSpace(ctx.Query("limit")); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	if q == "" {
		utils.Success(ctx, http.StatusOK, "success", []map[string]interface{}{})
		return
	}

	results, err := qc.QuizService.SearchQuizzes(q, limit)
	if err != nil {
		utils.SendError(ctx, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(ctx, http.StatusOK, "success", results)
}

type QuizPreferencesRequest struct {
	LanguagePreference string `form:"languagePreference" validate:"omitempty"`
	SubjectPreference  string `form:"subjectPreference" validate:"omitempty"`
	TestLevel          string `form:"testLevel" validate:"omitempty"`
	QuestionPreference string `form:"questionPreference" validate:"omitempty"`
	TimePreference     string `form:"timePreference" validate:"omitempty"`
}

type QuickStartRequest struct {
	LanguagePreference string `form:"languagePreference"`
	SubjectPreference  string `form:"subjectPreference"`
	TestLevel          string `form:"testLevel"`
	QuestionPreference string `form:"questionPreference"`
	TimePreference     string `form:"timePreference"`
	IsRandom           bool   `form:"isRandom"`
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

// QuickStart mirrors Nest GET /quiz/quick-start (quiz pack only).
// Supports ?isRandom=true and optional preference filters.
func (qc *QuizController) QuickStart(ctx *gin.Context) {
	var req QuickStartRequest
	if err := ctx.ShouldBindQuery(&req); err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	// Gin binds "true"/"false" strings for bool; also accept explicit query parse fallback
	if raw := strings.TrimSpace(ctx.Query("isRandom")); raw != "" {
		req.IsRandom = raw == "true" || raw == "1" || raw == "yes"
	}

	lang := strings.TrimSpace(req.LanguagePreference)
	subj := strings.TrimSpace(req.SubjectPreference)
	level := strings.TrimSpace(req.TestLevel)

	// Same defaults Nest used when isRandom or prefs are missing
	if req.IsRandom || lang == "" || subj == "" || level == "" {
		languages := []string{"yoruba"}
		subjects := []string{"general"}
		levels := []string{"basic"}

		if lang == "" {
			lang = languages[0]
		}
		if subj == "" {
			subj = subjects[0]
		}
		if level == "" {
			level = levels[0]
		}
	}

	questionPref := strings.TrimSpace(req.QuestionPreference)
	timePref := strings.TrimSpace(req.TimePreference)
	if questionPref == "" {
		questionPref = "25"
	}
	if timePref == "" {
		timePref = "5"
	}

	pack, err := qc.QuizService.GetQuizByPreferences(
		lang,
		subj,
		level,
		questionPref,
		timePref,
	)
	if err != nil {
		if appErr, ok := err.(*utils.AppError); ok {
			utils.SendError(ctx, appErr.Status, appErr.Code, appErr.Message)
			return
		}
		utils.SendError(ctx, http.StatusBadGateway, "BAD_GATEWAY", err.Error())
		return
	}

	// Enrich with quick-start metadata (Nest previously attached these)
	pack["isRandom"] = req.IsRandom
	pack["languagePreference"] = lang
	pack["subjectPreference"] = subj
	pack["testLevel"] = level
	pack["questionPreference"] = questionPref
	pack["timePreference"] = timePref

	utils.Success(ctx, http.StatusOK, "success", pack)
}

// GetOngoingQuiz mirrors Nest GET /quiz/get-ongoing-quiz/:id (session state in Postgres).
func (qc *QuizController) GetOngoingQuiz(ctx *gin.Context) {
	idParam := strings.TrimSpace(ctx.Param("id"))
	if idParam == "" {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", "user id is required")
		return
	}

	userID, err := strconv.Atoi(idParam)
	if err != nil || userID <= 0 {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", "invalid user id")
		return
	}

	result, err := services.FetchOngoingQuiz(userID)
	if errors.Is(err, services.ErrPostgresUnavailable) {
		utils.SendError(ctx, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", err.Error())
		return
	}
	if errors.Is(err, services.ErrOngoingQuizNotFound) {
		utils.SendError(ctx, http.StatusNotFound, "NOT_FOUND", "No ongoing quiz found.")
		return
	}
	if err != nil {
		utils.SendError(ctx, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	if result.Expired {
		ctx.JSON(http.StatusGone, gin.H{
			"expired": true,
			"message": result.ExpiredMessage,
		})
		return
	}

	if result.MissingQuizAttempt {
		payload := gin.H{
			"missingQuizAttempt": true,
			"quizId":             result.QuizID,
		}
		if result.OngoingQuiz != nil {
			raw, err := json.Marshal(result.OngoingQuiz)
			if err == nil {
				var ongoing map[string]interface{}
				if json.Unmarshal(raw, &ongoing) == nil {
					for key, value := range ongoing {
						payload[key] = value
					}
				}
			}
		}
		utils.Success(ctx, http.StatusOK, "Ongoing quiz fetched successfully", payload)
		return
	}

	utils.Success(ctx, http.StatusOK, "Ongoing quiz fetched successfully", result.OngoingQuiz)
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
		switch {
		case err.Error() == "invalid quiz id":
			status = http.StatusBadRequest
		case err.Error() == "quiz not found", errors.Is(err, mongo.ErrNoDocuments):
			status = http.StatusNotFound
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
		switch {
		case err.Error() == "invalid live quiz id":
			status = http.StatusBadRequest
		case err.Error() == "live quiz not found", errors.Is(err, mongo.ErrNoDocuments):
			status = http.StatusNotFound
		}

		utils.SendError(ctx, status, "ERROR", err.Error())
		return
	}

	utils.Success(ctx, http.StatusOK, "success", answer)
}

func (qc *QuizController) SubmitLiveQuizAnswer(ctx *gin.Context) {
	quizID := strings.TrimSpace(ctx.Param("id"))
	if quizID == "" {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", "live quiz id is required")
		return
	}

	userIDValue, ok := ctx.Get(middleware.ContextUserIDKey)
	if !ok {
		utils.SendError(ctx, http.StatusUnauthorized, "UNAUTHORIZED", "user authentication is required")
		return
	}

	userID, ok := userIDValue.(int)
	if !ok || userID <= 0 {
		utils.SendError(ctx, http.StatusUnauthorized, "UNAUTHORIZED", "invalid authenticated user")
		return
	}

	var body struct {
		SelectedAnswer string `json:"selectedAnswer"`
	}
	if err := ctx.ShouldBindJSON(&body); err != nil {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if strings.TrimSpace(body.SelectedAnswer) == "" {
		utils.SendError(ctx, http.StatusBadRequest, "BAD_REQUEST", "selectedAnswer is required")
		return
	}

	sessionID, err := services.FindActiveSessionIDByUserAndQuestion(userID, quizID)
	if err != nil {
		if errors.Is(err, services.ErrOngoingQuizNotFound) {
			utils.SendError(ctx, http.StatusNotFound, "NOT_FOUND", "Active live quiz not found")
			return
		}
		utils.SendError(ctx, http.StatusInternalServerError, "ERROR", err.Error())
		return
	}

	sessionService := services.NewQuizSessionV2Service(qc.QuizService)
	result, err := sessionService.SaveAnswer(sessionID, models.SaveAnswerV2Request{
		UserID:         userID,
		QuestionID:     quizID,
		SelectedAnswer: body.SelectedAnswer,
	})
	if err != nil {
		sendServiceError(ctx, err)
		return
	}

	utils.Success(ctx, http.StatusOK, "Live quiz answer submitted", gin.H{"answer": result.Answer})
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
	// Bind into a flexible map first so bad date/number shapes don't kill the process.
	var raw map[string]interface{}
	if err := c.ShouldBindJSON(&raw); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	liveQuiz, err := mapToLiveQuiz(raw)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	// Normalize typed-answer payloads from admin UI
	if liveQuiz.IsTypedAnswer {
		if strings.TrimSpace(liveQuiz.TypedAnswer) == "" && strings.TrimSpace(liveQuiz.Answer) != "" {
			liveQuiz.TypedAnswer = strings.TrimSpace(liveQuiz.Answer)
		}
		liveQuiz.Options = nil
	}

	if err := qc.QuizService.CreateLiveQuiz(liveQuiz); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	utils.Success(c, http.StatusCreated, "live quiz created successfully", buildLiveQuizResponse(liveQuiz))
}

// GET SINGLE LIVE QUIZ
func (qc *QuizController) GetLiveQuiz(c *gin.Context) {
	id := c.Param("id")

	liveQuiz, err := qc.QuizService.GetLiveQuiz(id)
	if err != nil {
		utils.SendError(c, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "success", buildLiveQuizResponse(liveQuiz))
}

func (q *QuizController) GetRandomLiveQuiz(c *gin.Context) {
	number := c.Param("number")

	quizzes, err := q.QuizService.GetRandomLiveQuiz(number)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	now := time.Now().UTC()
	response := make([]gin.H, 0, len(quizzes))
	for i := range quizzes {
		quizzes[i].IDHex = quizzes[i].ID.Hex()
		status := services.ComputeLiveQuizStatus(quizzes[i].QuizScheduleDate, quizzes[i].QuizFinishDate, now)
		response = append(response, gin.H{
			"id":                   quizzes[i].IDHex,
			"question":             quizzes[i].Question,
			"options":              quizzes[i].Options,
			"isTypedAnswer":        quizzes[i].IsTypedAnswer,
			"typedAnswer":          quizzes[i].TypedAnswer,
			"customCountdownLabel": strings.TrimSpace(quizzes[i].CustomCountdownLabel),
			"jackpotAmount":        quizzes[i].JackpotAmount,
			"totalPrize":           quizzes[i].TotalPrize,
			"recipients":           quizzes[i].Recipients,
			"unitPrize":            quizzes[i].UnitPrize,
			"showAnswer":           quizzes[i].ShowAnswer,
			"quizScheduleDate":     quizzes[i].QuizScheduleDate.UTC().Format(time.RFC3339),
			"quizFinishDate":       quizzes[i].QuizFinishDate.UTC().Format(time.RFC3339),
			"imageLink":            quizzes[i].ImageLink,
			"status":               status,
			"quizCountdownState":   status,
			"quizCountdownLabel": services.BuildLiveQuizCountdownLabel(
				quizzes[i].QuizScheduleDate,
				quizzes[i].QuizFinishDate,
				now,
				strings.TrimSpace(quizzes[i].CustomCountdownLabelBefore),
				strings.TrimSpace(quizzes[i].CustomCountdownLabelDuring),
				strings.TrimSpace(quizzes[i].CustomCountdownLabelAfter),
			),
		})
	}

	utils.Success(c, http.StatusOK, "success", response)
}

// GET ALL LIVE QUIZZES
func (qc *QuizController) GetAllLiveQuiz(c *gin.Context) {
	liveQuizzes, err := qc.QuizService.GetAllLiveQuiz()
	if err != nil {
		// Still return an empty list for admin UI instead of hard-failing the modal.
		utils.Success(c, http.StatusOK, err.Error(), []map[string]interface{}{})
		return
	}
	if liveQuizzes == nil {
		liveQuizzes = []map[string]interface{}{}
	}
	utils.Success(c, http.StatusOK, "success", liveQuizzes)
}

// DELETE LIVE QUIZ
func (qc *QuizController) DeleteLiveQuiz(c *gin.Context) {
	id := c.Param("id")

	err := qc.QuizService.DeleteLiveQuiz(id)
	if err != nil {
		if errors.Is(err, services.ErrLiveQuizActive) {
			utils.SendError(c, http.StatusForbidden, "FORBIDDEN", err.Error())
			return
		}
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "live quiz deleted successfully", nil)
}

// UPDATE LIVE QUIZ
func (qc *QuizController) UpdateLiveQuiz(c *gin.Context) {
	id := c.Param("id")

	var raw map[string]interface{}
	if err := c.ShouldBindJSON(&raw); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid id format")
		return
	}

	existing, err := qc.QuizService.GetLiveQuiz(id)
	if err != nil {
		utils.SendError(c, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}

	liveQuiz := *existing
	patchQuiz, err := mapToLiveQuiz(raw)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if _, ok := raw["question"]; ok {
		liveQuiz.Question = patchQuiz.Question
	}
	if _, ok := raw["options"]; ok {
		liveQuiz.Options = patchQuiz.Options
	}
	if _, ok := raw["answer"]; ok {
		liveQuiz.Answer = patchQuiz.Answer
	}
	if _, ok := raw["typedAnswer"]; ok {
		liveQuiz.TypedAnswer = patchQuiz.TypedAnswer
	}
	if _, ok := raw["isTypedAnswer"]; ok {
		liveQuiz.IsTypedAnswer = patchQuiz.IsTypedAnswer
	}
	if _, ok := raw["jackpotAmount"]; ok {
		liveQuiz.JackpotAmount = patchQuiz.JackpotAmount
	}
	if _, ok := raw["totalPrize"]; ok {
		liveQuiz.TotalPrize = patchQuiz.TotalPrize
	}
	if _, ok := raw["recipients"]; ok {
		liveQuiz.Recipients = patchQuiz.Recipients
	}
	if _, ok := raw["unitPrize"]; ok {
		liveQuiz.UnitPrize = patchQuiz.UnitPrize
	}
	if _, ok := raw["showAnswer"]; ok {
		liveQuiz.ShowAnswer = patchQuiz.ShowAnswer
	}
	if _, ok := raw["quizScheduleDate"]; ok {
		liveQuiz.QuizScheduleDate = patchQuiz.QuizScheduleDate
	}
	if _, ok := raw["quizFinishDate"]; ok {
		liveQuiz.QuizFinishDate = patchQuiz.QuizFinishDate
	}
	if _, ok := raw["imageLink"]; ok {
		liveQuiz.ImageLink = patchQuiz.ImageLink
	}
	if _, ok := raw["customCountdownLabel"]; ok {
		liveQuiz.CustomCountdownLabel = patchQuiz.CustomCountdownLabel
	}
	if _, ok := raw["customCountdownLabelBefore"]; ok {
		liveQuiz.CustomCountdownLabelBefore = patchQuiz.CustomCountdownLabelBefore
	}
	if _, ok := raw["customCountdownLabelDuring"]; ok {
		liveQuiz.CustomCountdownLabelDuring = patchQuiz.CustomCountdownLabelDuring
	}
	if _, ok := raw["customCountdownLabelAfter"]; ok {
		liveQuiz.CustomCountdownLabelAfter = patchQuiz.CustomCountdownLabelAfter
	}

	liveQuiz.ID = objectId

	err = qc.QuizService.UpdateLiveQuiz(&liveQuiz)
	if err != nil {
		if errors.Is(err, services.ErrLiveQuizActive) {
			utils.SendError(c, http.StatusForbidden, "FORBIDDEN", err.Error())
			return
		}
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "live quiz updated successfully", nil)
}

func (qc *QuizController) UpdateLiveQuizCustomCountdownLabel(c *gin.Context) {
	id := c.Param("id")

	var payload liveQuizCountdownLabelPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	if strings.TrimSpace(payload.CustomCountdownLabel) == "" {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "custom countdown label is required")
		return
	}

	if err := qc.QuizService.UpdateLiveQuizCustomCountdownLabel(id, payload.CustomCountdownLabel); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	liveQuiz, err := qc.QuizService.GetLiveQuiz(id)
	if err != nil {
		utils.SendError(c, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}

	response := buildLiveQuizResponse(liveQuiz)

	// Broadcast the updated quiz to all connected clients via WebSocket
	broadcastEvent := gin.H{
		"event": "liveQuizUpdated",
		"quiz":  response,
	}
	BroadcastToRoom(fmt.Sprintf("stream:%s", id), broadcastEvent)

	utils.Success(c, http.StatusOK, "live quiz custom countdown label updated successfully", response)
}

func (qc *QuizController) DeleteLiveQuizCustomCountdownLabel(c *gin.Context) {
	id := c.Param("id")

	if err := qc.QuizService.DeleteLiveQuizCustomCountdownLabel(id); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	liveQuiz, err := qc.QuizService.GetLiveQuiz(id)
	if err != nil {
		utils.SendError(c, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}

	response := buildLiveQuizResponse(liveQuiz)

	// Broadcast the updated quiz to all connected clients via WebSocket
	broadcastEvent := gin.H{
		"event": "liveQuizUpdated",
		"quiz":  response,
	}
	BroadcastToRoom(fmt.Sprintf("stream:%s", id), broadcastEvent)

	utils.Success(c, http.StatusOK, "live quiz custom countdown label deleted successfully", response)
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

func mapToLiveQuiz(raw map[string]interface{}) (*models.LiveQuiz, error) {
	quiz := &models.LiveQuiz{}

	quiz.Question = strings.TrimSpace(asString(raw["question"]))
	quiz.Answer = strings.TrimSpace(asString(raw["answer"]))
	quiz.TypedAnswer = strings.TrimSpace(asString(raw["typedAnswer"]))
	quiz.IsTypedAnswer = asBool(raw["isTypedAnswer"])
	quiz.ShowAnswer = asBool(raw["showAnswer"])
	quiz.Options = asStringSlice(raw["options"])
	quiz.ImageLink = asStringSlice(raw["imageLink"])
	quiz.CustomCountdownLabel = strings.TrimSpace(asString(raw["customCountdownLabel"]))
	quiz.CustomCountdownLabelBefore = strings.TrimSpace(asString(raw["customCountdownLabelBefore"]))
	quiz.CustomCountdownLabelDuring = strings.TrimSpace(asString(raw["customCountdownLabelDuring"]))
	quiz.CustomCountdownLabelAfter = strings.TrimSpace(asString(raw["customCountdownLabelAfter"]))

	recipients, err := asInt(raw["recipients"])
	if err != nil {
		return nil, fmt.Errorf("invalid recipients: %v", err)
	}
	quiz.Recipients = recipients

	totalPrize, err := asFloat(raw["totalPrize"])
	if err != nil {
		return nil, fmt.Errorf("invalid totalPrize: %v", err)
	}
	quiz.TotalPrize = totalPrize
	quiz.JackpotAmount = totalPrize

	if jackpotRaw, ok := raw["jackpotAmount"]; ok {
		jackpotAmount, err := asFloat(jackpotRaw)
		if err != nil {
			return nil, fmt.Errorf("invalid jackpotAmount: %v", err)
		}
		if jackpotAmount > 0 {
			quiz.JackpotAmount = jackpotAmount
			quiz.TotalPrize = jackpotAmount
		}
	}

	unitPrize, err := asFloat(raw["unitPrize"])
	if err != nil {
		return nil, fmt.Errorf("invalid unitPrize: %v", err)
	}
	quiz.UnitPrize = unitPrize

	if scheduleRaw, ok := raw["quizScheduleDate"]; ok {
		schedule, err := asTime(scheduleRaw)
		if err != nil {
			return nil, fmt.Errorf("invalid quizScheduleDate: %v", err)
		}
		quiz.QuizScheduleDate = schedule
	} else {
		quiz.QuizScheduleDate = defaultWeekdayNoon()
	}

	if finishRaw, ok := raw["quizFinishDate"]; ok {
		finishAt, err := asTime(finishRaw)
		if err != nil {
			return nil, fmt.Errorf("invalid quizFinishDate: %v", err)
		}
		quiz.QuizFinishDate = finishAt
	} else if !quiz.QuizScheduleDate.IsZero() {
		quiz.QuizFinishDate = quiz.QuizScheduleDate.Add(30 * time.Minute)
	}

	return quiz, nil
}

func defaultWeekdayNoon() time.Time {
	location, err := time.LoadLocation("Africa/Lagos")
	if err != nil {
		location = time.FixedZone("WAT", 3600)
	}
	now := time.Now().In(location)
	next := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, location)
	if !next.After(now) {
		next = next.Add(24 * time.Hour)
	}
	for next.Weekday() == time.Saturday || next.Weekday() == time.Sunday {
		next = next.Add(24 * time.Hour)
	}
	return next.UTC()
}

func asString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case fmt.Stringer:
		return t.String()
	case float64:
		return fmt.Sprintf("%.0f", t)
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", t)
	}
}

func asBool(v interface{}) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(t, "true") || t == "1"
	case float64:
		return t != 0
	default:
		return false
	}
}

func asStringSlice(v interface{}) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []interface{}:
		out := make([]string, 0, len(t))
		for _, item := range t {
			s := strings.TrimSpace(asString(item))
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return nil
		}
		return []string{s}
	default:
		return nil
	}
}

func asInt(v interface{}) (int, error) {
	switch t := v.(type) {
	case float64:
		return int(t), nil
	case int:
		return t, nil
	case int64:
		return int(t), nil
	case string:
		var n int
		_, err := fmt.Sscanf(strings.TrimSpace(t), "%d", &n)
		return n, err
	case nil:
		return 0, nil
	default:
		return 0, fmt.Errorf("unsupported type %T", v)
	}
}

func asFloat(v interface{}) (float64, error) {
	switch t := v.(type) {
	case float64:
		return t, nil
	case int:
		return float64(t), nil
	case int64:
		return float64(t), nil
	case string:
		var n float64
		_, err := fmt.Sscanf(strings.TrimSpace(t), "%f", &n)
		return n, err
	case nil:
		return 0, nil
	default:
		return 0, fmt.Errorf("unsupported type %T", v)
	}
}

func asTime(v interface{}) (time.Time, error) {
	switch t := v.(type) {
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return time.Time{}, fmt.Errorf("empty date")
		}
		formats := []string{
			time.RFC3339Nano,
			time.RFC3339,
			"2006-01-02T15:04:05Z07:00",
			"2006-01-02T15:04:05",
			"2006-01-02 15:04:05",
			"2006-01-02",
		}
		var lastErr error
		for _, f := range formats {
			parsed, err := time.Parse(f, s)
			if err == nil {
				return parsed, nil
			}
			lastErr = err
		}
		return time.Time{}, lastErr
	case float64:
		// unix seconds or ms
		if t > 1e12 {
			return time.UnixMilli(int64(t)), nil
		}
		return time.Unix(int64(t), 0), nil
	case nil:
		return time.Time{}, fmt.Errorf("missing date")
	default:
		return time.Time{}, fmt.Errorf("unsupported type %T", v)
	}
}

func RegisterQuizRoutes(
	rg *gin.RouterGroup,
	qc *QuizController,
	qsc *QuizSubmissionController,
) {
	quizroute := rg.Group("/quiz")

	// Airtable Webhook stays public
	quizroute.POST("/airtable-webhook", qc.AirtableWebhook)

	// Live quiz reads — public (stream player + schedule polling).
	quizroute.GET("/live", qc.GetAllLiveQuiz)
	quizroute.GET("/live/random/:number", qc.GetRandomLiveQuiz)
	quizroute.GET("/live/:id", qc.GetLiveQuiz)
	quizroute.GET("/live-answer/:id", qc.GetLiveQuizAnswerById)

	// Quiz search — public (used by admin create-quiz autocomplete)
	quizroute.GET("/search", qc.SearchQuizzes)

	// Quiz CRUD and related routes are now public so the admin Q&A table can fetch them without a Clerk session.
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
	quizroute.GET("/quick-start", qc.QuickStart)
	quizroute.GET("/get-ongoing-quiz/:id", qc.GetOngoingQuiz)
	quizroute.POST("/submit", qc.SubmitQuiz)

	// ── Submissions ────────────────────────────────────────
	quizroute.GET("/get-quiz-submissions", qsc.GetAllSubmissions)
	quizroute.GET("/get-user-submissions/:userId", qsc.GetUserSubmissions)

	// ── Live Quiz writes ───────────────────────────────────
	quizroute.POST("/live", qc.CreateLiveQuiz)
	quizroute.PATCH("/live/:id", qc.UpdateLiveQuiz)
	quizroute.PUT("/live/:id", qc.UpdateLiveQuiz)
	quizroute.DELETE("/live/:id", qc.DeleteLiveQuiz)
}
