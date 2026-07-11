package services

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/utils"
)

var (
	ErrOngoingQuizNotFound = errors.New("no ongoing quiz found")
	ErrPostgresUnavailable = errors.New("postgres is not configured")
)

type OngoingQuizFetchResult struct {
	Expired             bool
	ExpiredMessage      string
	MissingQuizAttempt  bool
	QuizID              string
	OngoingQuiz         *models.OngoingQuiz
}

// FetchOngoingQuiz mirrors Nest quizService.fetchOngoingQuiz(userId).
func FetchOngoingQuiz(userID int) (*OngoingQuizFetchResult, error) {
	if utils.DB == nil {
		return nil, ErrPostgresUnavailable
	}

	var ongoingQuiz models.OngoingQuiz
	err := utils.DB.
		Preload("QuizAttempt").
		Where(`"userId" = ? AND "isCompleted" = ?`, userID, false).
		Order(`"createdAt" DESC`).
		First(&ongoingQuiz).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrOngoingQuizNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("fetch ongoing quiz: %w", err)
	}

	now, err := lagosNow()
	if err != nil {
		return nil, err
	}

	if ongoingQuiz.IsRandom {
		if ongoingQuiz.QuizAttempt == nil {
			return &OngoingQuizFetchResult{
				MissingQuizAttempt: true,
				QuizID:             ongoingQuiz.ID,
			}, nil
		}

		attempt := ongoingQuiz.QuizAttempt
		if attempt.IsStarted &&
			attempt.ExpiresAt != nil &&
			!attempt.ExpiresAt.After(now) {
			return &OngoingQuizFetchResult{
				Expired:        true,
				ExpiredMessage: "Your quiz has expired. Please start a new quiz.",
			}, nil
		}

		return &OngoingQuizFetchResult{OngoingQuiz: &ongoingQuiz}, nil
	}

	if ongoingQuiz.ExpiresAt != nil && !ongoingQuiz.ExpiresAt.After(now) {
		return &OngoingQuizFetchResult{
			Expired:        true,
			ExpiredMessage: "Your quiz has expired. Please start a new quiz.",
		}, nil
	}

	return &OngoingQuizFetchResult{OngoingQuiz: &ongoingQuiz}, nil
}
