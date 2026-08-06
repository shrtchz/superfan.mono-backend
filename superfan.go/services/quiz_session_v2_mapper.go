package services

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"quiz.superfan.com/apis/models"
)

func isoTimePtr(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339Nano)
	return &formatted
}

func isoTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func normalizeStoredQuestions(raw json.RawMessage) []models.SessionV2Question {
	if len(raw) == 0 {
		return []models.SessionV2Question{}
	}

	var items []map[string]interface{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return []models.SessionV2Question{}
	}

	questions := make([]models.SessionV2Question, 0, len(items))
	for _, item := range items {
		questions = append(questions, mapStoredQuestion(item))
	}
	return questions
}

func mapStoredQuestion(item map[string]interface{}) models.SessionV2Question {
	level := strings.ToLower(strings.TrimSpace(stringField(item, "testLevel")))
	options := stringSliceField(item["options"])
	images := stringSliceField(item["imageLink"])
	if len(images) == 0 {
		images = stringSliceField(item["images"])
	}
	videos := stringSliceField(item["videoLink"])
	if len(videos) == 0 {
		videos = stringSliceField(item["videos"])
	}

	earning := 0
	if raw := stringField(item, "earning"); raw != "" {
		if parsed, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil {
			earning = parsed
		}
	}

	id := stringField(item, "id")
	if id == "" {
		id = stringField(item, "_id")
	}

	return models.SessionV2Question{
		ID:            id,
		Text:          stringField(item, "question"),
		Options:       options,
		Level:         level,
		Subject:       strings.TrimSpace(stringField(item, "subject")),
		Language:      strings.TrimSpace(stringField(item, "testQuiz")),
		Earning:       earning,
		Images:        images,
		Videos:        videos,
		InputRequired: level == "basic" && len(options) == 0,
	}
}

func mapOngoingQuizToSessionV2(record *models.OngoingQuiz, expired bool) models.SessionV2 {
	mode := sessionModeCustom
	if record.IsRandom {
		mode = sessionModeRandom
	}

	return models.SessionV2{
		ID:               record.ID,
		UserID:           record.UserID,
		Mode:             mode,
		Status:           deriveSessionStatus(record, expired),
		Questions:        normalizeStoredQuestions(record.Questions),
		Answers:          normalizeStoredAnswers(record.Answers),
		CurrentIndex:     record.CurrentIndex,
		TotalQuestions:   record.TotalQuestions,
		TimeLimitSeconds: sessionTimeLimitSeconds(record.TotalTime),
		StartedAt:        sessionStartedAt(record),
		ExpiresAt:        sessionExpiresAt(record),
		CreatedAt:        isoTime(record.CreatedAt),
	}
}

func deriveSessionStatus(record *models.OngoingQuiz, expired bool) string {
	if expired {
		return "expired"
	}
	if record.IsRandom {
		if record.QuizAttempt != nil && !record.QuizAttempt.IsStarted {
			return "ready"
		}
		if record.StartedAt == nil {
			return "ready"
		}
	}
	return "in_progress"
}

func sessionTimeLimitSeconds(totalTime *int) *int {
	if totalTime == nil || *totalTime <= 0 {
		return nil
	}
	seconds := *totalTime * 60
	return &seconds
}

func sessionStartedAt(record *models.OngoingQuiz) *string {
	if record.IsRandom {
		if record.QuizAttempt != nil && record.QuizAttempt.IsStarted {
			return isoTimePtr(record.QuizAttempt.StartedAt)
		}
		return nil
	}
	return isoTimePtr(record.StartedAt)
}

func sessionExpiresAt(record *models.OngoingQuiz) *string {
	if record.IsRandom {
		if record.QuizAttempt != nil && record.QuizAttempt.IsStarted {
			return isoTimePtr(record.QuizAttempt.ExpiresAt)
		}
		return nil
	}
	return isoTimePtr(record.ExpiresAt)
}

func normalizeStoredAnswers(raw json.RawMessage) []models.SessionV2Answer {
	if len(raw) == 0 {
		return []models.SessionV2Answer{}
	}

	var items []map[string]interface{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return []models.SessionV2Answer{}
	}

	answers := make([]models.SessionV2Answer, 0, len(items))
	for _, item := range items {
		questionID := stringField(item, "quizId")
		if questionID == "" {
			questionID = stringField(item, "questionId")
		}
		selectedAnswer := stringField(item, "selectedAnswer")
		if questionID == "" || selectedAnswer == "" {
			continue
		}

		answeredAt := stringField(item, "answeredAt")
		if answeredAt == "" {
			answeredAt = isoTime(time.Now().UTC())
		}

		isCorrect := false
		if rawCorrect, ok := item["isCorrect"]; ok {
			switch typed := rawCorrect.(type) {
			case bool:
				isCorrect = typed
			case string:
				isCorrect = strings.EqualFold(strings.TrimSpace(typed), "true")
			}
		}

		answers = append(answers, models.SessionV2Answer{
			QuestionID:     questionID,
			SelectedAnswer: selectedAnswer,
			IsCorrect:      isCorrect,
			AnsweredAt:     answeredAt,
		})
	}

	return answers
}

func stringField(item map[string]interface{}, key string) string {
	value, ok := item[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func stringSliceField(value interface{}) []string {
	switch typed := value.(type) {
	case []string:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			trimmed := strings.TrimSpace(item)
			if trimmed != "" {
				out = append(out, trimmed)
			}
		}
		return out
	case []interface{}:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		return []string{}
	}
}
