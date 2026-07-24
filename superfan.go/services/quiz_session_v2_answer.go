package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/utils"
)

var mongoObjectIDPattern = regexp.MustCompile(`^[a-f\d]{24}$`)

type storedSessionAnswer struct {
	QuizID         string    `json:"quizId"`
	SelectedAnswer string    `json:"selectedAnswer"`
	AnsweredAt     time.Time `json:"answeredAt"`
	IsCorrect      bool      `json:"isCorrect,omitempty"`
}

type liveQuizSubmission struct {
	QuizID         string `json:"quizId"`
	SelectedAnswer string `json:"selectedAnswer"`
	SubmittedAt    string `json:"submittedAt"`
}

type ongoingLiveQuizRecord struct {
	ID        int             `gorm:"column:id"`
	UserID    string          `gorm:"column:userId"`
	QuizIDs   []string        `gorm:"column:quizIds;type:text[]"`
	Answers   json.RawMessage `gorm:"column:answers"`
	Completed bool            `gorm:"column:completed"`
	CreatedAt time.Time       `gorm:"column:createdAt"`
	UpdatedAt time.Time       `gorm:"column:updatedAt"`
}

func (ongoingLiveQuizRecord) TableName() string {
	return "ongoing_live_quiz"
}

func buildOngoingLiveQuizRecord(userID string, quizIDs []string, answersJSON []byte, submittedAt time.Time) ongoingLiveQuizRecord {
	return ongoingLiveQuizRecord{
		UserID:    userID,
		QuizIDs:   quizIDs,
		Answers:   answersJSON,
		Completed: false,
		CreatedAt: submittedAt,
		UpdatedAt: submittedAt,
	}
}

func mergeLiveQuizSubmissionAnswers(existingAnswers []byte, quizID, selectedAnswer string, submittedAt time.Time) ([]byte, error) {
	var answers []liveQuizSubmission
	if len(existingAnswers) > 0 {
		if err := json.Unmarshal(existingAnswers, &answers); err != nil {
			return nil, err
		}
	}

	updated := false
	for i := range answers {
		if answers[i].QuizID == quizID {
			answers[i].SelectedAnswer = selectedAnswer
			answers[i].SubmittedAt = submittedAt.UTC().Format(time.RFC3339)
			updated = true
			break
		}
	}
	if !updated {
		answers = append(answers, liveQuizSubmission{
			QuizID:         quizID,
			SelectedAnswer: selectedAnswer,
			SubmittedAt:    submittedAt.UTC().Format(time.RFC3339),
		})
	}

	return json.Marshal(answers)
}

func persistLiveQuizAnswer(userID int, quizID, selectedAnswer string, submittedAt time.Time) error {
	if utils.DB == nil {
		return nil
	}

	if quizID == "" || selectedAnswer == "" {
		return nil
	}

	userIDValue := strconv.Itoa(userID)
	var record ongoingLiveQuizRecord
	queryErr := utils.DB.Where(`"userId" = ? AND "completed" = ?`, userIDValue, false).First(&record).Error
	if queryErr != nil && !errors.Is(queryErr, gorm.ErrRecordNotFound) {
		return queryErr
	}

	answersJSON, mergeErr := mergeLiveQuizSubmissionAnswers(record.Answers, quizID, selectedAnswer, submittedAt)
	if mergeErr != nil {
		return mergeErr
	}

	quizIDs := append([]string{}, record.QuizIDs...)
	if !containsString(quizIDs, quizID) {
		quizIDs = append(quizIDs, quizID)
	}

	if errors.Is(queryErr, gorm.ErrRecordNotFound) {
		recordToCreate := buildOngoingLiveQuizRecord(userIDValue, quizIDs, answersJSON, submittedAt)
		return utils.DB.Create(&recordToCreate).Error
	}

	return utils.DB.Model(&record).Updates(map[string]interface{}{
		"quizIds":   quizIDs,
		"answers":   answersJSON,
		"updatedAt": submittedAt,
	}).Error
}

func shouldCreateLiveQuizRecord(queryErr error) bool {
	return errors.Is(queryErr, gorm.ErrRecordNotFound)
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func ensureSessionAcceptsAnswers(lookup *activeSessionLookup) error {
	if lookup.expired {
		return utils.NewAppError(http.StatusGone, "SESSION_EXPIRED", "Quiz session has expired.")
	}

	record := lookup.record
	if record.IsRandom {
		if record.QuizAttempt == nil || !record.QuizAttempt.IsStarted {
			return utils.NewAppError(http.StatusBadRequest, "SESSION_NOT_IN_PROGRESS", "Please begin the quiz before submitting answers.")
		}
		return nil
	}

	if record.StartedAt == nil {
		return utils.NewAppError(http.StatusBadRequest, "SESSION_NOT_IN_PROGRESS", "Quiz session is not in progress.")
	}

	return nil
}

func parseStoredSessionAnswers(raw json.RawMessage) []storedSessionAnswer {
	if len(raw) == 0 {
		return []storedSessionAnswer{}
	}

	var answers []storedSessionAnswer
	if err := json.Unmarshal(raw, &answers); err != nil {
		return []storedSessionAnswer{}
	}
	return answers
}

func findQuestionInSession(record *models.OngoingQuiz, questionID string) (map[string]interface{}, error) {
	questions := normalizeStoredQuestions(record.Questions)
	for _, question := range questions {
		if question.ID == questionID {
			return map[string]interface{}{
				"id":        question.ID,
				"question":  question.Text,
				"options":   question.Options,
				"earning":   fmt.Sprint(question.Earning),
				"testLevel": question.Level,
			}, nil
		}
	}

	items := []map[string]interface{}{}
	if err := json.Unmarshal(record.Questions, &items); err == nil {
		for _, item := range items {
			id := stringField(item, "id")
			if id == "" {
				id = stringField(item, "_id")
			}
			if id == questionID {
				return item, nil
			}
		}
	}

	return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_QUESTION", "Question does not belong to this session.")
}

func normalizeAnswerText(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func answersMatch(selectedAnswer string, correctAnswer string) bool {
	return normalizeAnswerText(selectedAnswer) == normalizeAnswerText(correctAnswer)
}

func gradeAnswer(selectedAnswer, correctAnswer string, options []string) bool {
	if answersMatch(selectedAnswer, correctAnswer) {
		return true
	}

	correctIndex := resolveCorrectOptionIndex(correctAnswer, options)
	if correctIndex < 0 {
		return false
	}

	if len(options) > correctIndex && answersMatch(selectedAnswer, options[correctIndex]) {
		return true
	}

	normalizedSelected := strings.TrimSpace(strings.ToLower(selectedAnswer))
	if len(normalizedSelected) >= 1 {
		letter := normalizedSelected[0]
		if letter >= 'a' && letter <= 'z' {
			return int(letter-'a') == correctIndex
		}
	}

	return false
}

func resolveCorrectOptionIndex(correctAnswer string, options []string) int {
	normalizedCorrect := normalizeAnswerText(correctAnswer)
	for index, option := range options {
		if normalizeAnswerText(option) == normalizedCorrect {
			return index
		}
	}

	if len(normalizedCorrect) == 1 {
		letter := normalizedCorrect[0]
		if letter >= 'a' && letter <= 'z' {
			index := int(letter - 'a')
			if index >= 0 && index < len(options) {
				return index
			}
		}
	}

	return -1
}

func buildCorrectAnswerDisplay(correctAnswer string, options []string) string {
	if index := resolveCorrectOptionIndex(correctAnswer, options); index >= 0 {
		letter := string(rune('A' + index))
		return fmt.Sprintf("%s. %s", letter, options[index])
	}
	return correctAnswer
}

func questionEarningValue(question map[string]interface{}, isCorrect bool) int {
	if !isCorrect {
		return 0
	}
	raw := stringField(question, "earning")
	if raw == "" {
		return 0
	}
	var earning int
	fmt.Sscanf(strings.TrimSpace(raw), "%d", &earning)
	return earning
}

// SaveAnswer persists one answer and returns immediate feedback.
func (s *QuizSessionV2Service) SaveAnswer(sessionID string, req models.SaveAnswerV2Request) (*models.SaveAnswerV2Result, error) {
	if utils.DB == nil {
		return nil, utils.NewAppError(http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "postgres is not configured")
	}

	questionID := strings.TrimSpace(req.QuestionID)
	selectedAnswer := strings.TrimSpace(req.SelectedAnswer)
	if !mongoObjectIDPattern.MatchString(questionID) {
		return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_QUESTION", "questionId must be a valid quiz id.")
	}
	if selectedAnswer == "" {
		return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_ANSWER", "selectedAnswer is required.")
	}

	if _, err := s.loadUser(req.UserID); err != nil {
		return nil, err
	}

	lookup, err := loadSessionByID(sessionID, req.UserID, false)
	if err != nil {
		return nil, err
	}

	if err := ensureSessionAcceptsAnswers(lookup); err != nil {
		return nil, err
	}

	question, err := findQuestionInSession(lookup.record, questionID)
	if err != nil {
		return nil, err
	}

	answerPayload, err := s.quizService.GetQuizAnswerById(questionID)
	if err != nil {
		return nil, utils.NewAppError(http.StatusUnprocessableEntity, "ANSWER_LOOKUP_FAILED", "Unable to verify answer for this question.")
	}

	correctAnswer := stringField(answerPayload, "answer")
	if correctAnswer == "" {
		return nil, utils.NewAppError(http.StatusUnprocessableEntity, "ANSWER_LOOKUP_FAILED", "Correct answer was not found for this question.")
	}

	options := stringSliceField(question["options"])
	isCorrect := gradeAnswer(selectedAnswer, correctAnswer, options)
	correctDisplay := buildCorrectAnswerDisplay(correctAnswer, options)
	earning := questionEarningValue(question, isCorrect)

	now, err := lagosNow()
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to resolve timezone")
	}

	answers := parseStoredSessionAnswers(lookup.record.Answers)
	updated := false
	for index := range answers {
		if answers[index].QuizID == questionID {
			answers[index].SelectedAnswer = selectedAnswer
			answers[index].AnsweredAt = now
			answers[index].IsCorrect = isCorrect
			updated = true
			break
		}
	}
	if !updated {
		answers = append(answers, storedSessionAnswer{
			QuizID:         questionID,
			SelectedAnswer: selectedAnswer,
			AnsweredAt:     now,
			IsCorrect:      isCorrect,
		})
	}

	answersJSON, err := json.Marshal(answers)
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to persist answer")
	}

	currentIndex := len(answers)
	if err := utils.DB.Model(&models.OngoingQuiz{}).
		Where(`"id" = ? AND "userId" = ? AND "isCompleted" = ?`, sessionID, req.UserID, false).
		Updates(map[string]interface{}{
			"answers":      json.RawMessage(answersJSON),
			"currentIndex": currentIndex,
			"updatedAt":    now,
		}).Error; err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to save answer")
	}

	totalQuestions := lookup.record.TotalQuestions
	return &models.SaveAnswerV2Result{
		Answer: models.SavedAnswerV2Feedback{
			QuestionID:           questionID,
			SelectedAnswer:       selectedAnswer,
			IsCorrect:            isCorrect,
			CorrectAnswer:        correctAnswer,
			CorrectAnswerDisplay: correctDisplay,
			Earning:              earning,
			AnsweredAt:           isoTime(now),
		},
		Session: models.SaveAnswerV2Session{
			ID:             sessionID,
			CurrentIndex:   currentIndex,
			AnswersCount:   len(answers),
			IsLastQuestion: currentIndex >= totalQuestions,
			Status:         deriveSessionStatus(lookup.record, false),
		},
	}, nil
}

// GradeLiveAnswer grades a single live quiz answer without requiring an ongoing session.
// This is used for live-quiz submissions that should not be correlated with Postgres sessions.
func (s *QuizSessionV2Service) GradeLiveAnswer(req models.SaveAnswerV2Request) (*models.SaveAnswerV2Result, error) {
	if _, err := s.loadUser(req.UserID); err != nil {
		return nil, err
	}

	questionID := strings.TrimSpace(req.QuestionID)
	selectedAnswer := strings.TrimSpace(req.SelectedAnswer)
	if !mongoObjectIDPattern.MatchString(questionID) {
		return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_QUESTION", "questionId must be a valid quiz id.")
	}
	if selectedAnswer == "" {
		return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_ANSWER", "selectedAnswer is required.")
	}

	answerPayload, err := s.quizService.GetQuizAnswerById(questionID)
	question := map[string]interface{}{}
	var correctAnswer string
	var options []string
	if err != nil {
		liveQuiz, liveErr := s.quizService.GetLiveQuiz(questionID)
		if liveErr != nil {
			return nil, utils.NewAppError(http.StatusUnprocessableEntity, "ANSWER_LOOKUP_FAILED", "Unable to verify answer for this question.")
		}
		correctAnswer = liveQuiz.Answer
		options = liveQuiz.Options
	} else {
		correctAnswer = stringField(answerPayload, "answer")
		if opts, ok := answerPayload["options"]; ok {
			question["options"] = opts
		}
	}

	if correctAnswer == "" {
		return nil, utils.NewAppError(http.StatusUnprocessableEntity, "ANSWER_LOOKUP_FAILED", "Correct answer was not found for this question.")
	}

	if len(options) == 0 {
		options = stringSliceField(question["options"])
	}

	isCorrect := gradeAnswer(selectedAnswer, correctAnswer, options)
	correctDisplay := buildCorrectAnswerDisplay(correctAnswer, options)
	earning := questionEarningValue(question, isCorrect)

	now, err := lagosNow()
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to resolve timezone")
	}

	// if err := persistLiveQuizAnswer(req.UserID, questionID, selectedAnswer, now); err != nil {
	// 	return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to persist live quiz answer")
	// }
	if err := persistLiveQuizAnswer(req.UserID, questionID, selectedAnswer, now); err != nil {
		return nil, utils.NewAppError(
			http.StatusInternalServerError,
			"INTERNAL_SERVER_ERROR",
			fmt.Sprintf("failed to persist live quiz answer: %v", err),
		)
	}

	// Return a result without mutating Postgres session state.
	return &models.SaveAnswerV2Result{
		Answer: models.SavedAnswerV2Feedback{
			QuestionID:           questionID,
			SelectedAnswer:       selectedAnswer,
			IsCorrect:            isCorrect,
			CorrectAnswer:        correctAnswer,
			CorrectAnswerDisplay: correctDisplay,
			Earning:              earning,
			AnsweredAt:           isoTime(now),
		},
		Session: models.SaveAnswerV2Session{
			ID:             "",
			CurrentIndex:   0,
			AnswersCount:   0,
			IsLastQuestion: false,
			Status:         "live",
		},
	}, nil
}

func buildSubmitResponsesFromSession(record *models.OngoingQuiz) []models.QuizAnswerRequest {
	answers := parseStoredSessionAnswers(record.Answers)
	responses := make([]models.QuizAnswerRequest, 0, len(answers))
	for _, answer := range answers {
		quizID := strings.TrimSpace(answer.QuizID)
		selected := strings.TrimSpace(answer.SelectedAnswer)
		if quizID == "" || selected == "" || !mongoObjectIDPattern.MatchString(quizID) {
			continue
		}
		responses = append(responses, models.QuizAnswerRequest{
			QuizID:         quizID,
			SelectedAnswer: selected,
		})
	}
	return responses
}

func buildAllStoredSubmitResponses(record *models.OngoingQuiz) []models.QuizAnswerRequest {
	answers := parseStoredSessionAnswers(record.Answers)
	responses := make([]models.QuizAnswerRequest, 0, len(answers))
	for _, answer := range answers {
		quizID := strings.TrimSpace(answer.QuizID)
		selected := strings.TrimSpace(answer.SelectedAnswer)
		if quizID == "" || selected == "" {
			continue
		}
		responses = append(responses, models.QuizAnswerRequest{
			QuizID:         quizID,
			SelectedAnswer: selected,
		})
	}
	return responses
}

func mapSubmissionResponses(submission models.QuizSubmission) []map[string]interface{} {
	items := make([]map[string]interface{}, 0, len(submission.Responses))
	for _, response := range submission.Responses {
		items = append(items, map[string]interface{}{
			"questionId":     response.QuizID.Hex(),
			"quizId":         response.QuizID.Hex(),
			"selectedAnswer": response.SelectedAnswer,
			"correctAnswer":  response.CorrectAnswer,
			"isCorrect":      response.IsCorrect,
			"earning":        response.Earning,
			"subject":        response.Subject,
		})
	}
	return items
}

func countCorrectResponses(submission models.QuizSubmission) int {
	total := 0
	for _, response := range submission.Responses {
		if response.IsCorrect {
			total++
		}
	}
	return total
}
