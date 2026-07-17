package services

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/utils"
)

// SubmitSession grades saved answers, applies rewards, and completes the session.
func (s *QuizSessionV2Service) SubmitSession(sessionID string, req models.FinalizeSessionV2Request) (*models.FinalizeSessionV2Result, error) {
	return s.finalizeSession(sessionID, req, false)
}

// QuitSession ends a session early, grading saved answers when present.
func (s *QuizSessionV2Service) QuitSession(sessionID string, req models.FinalizeSessionV2Request) (*models.FinalizeSessionV2Result, error) {
	return s.finalizeSession(sessionID, req, true)
}

func (s *QuizSessionV2Service) finalizeSession(
	sessionID string,
	req models.FinalizeSessionV2Request,
	quit bool,
) (*models.FinalizeSessionV2Result, error) {
	if utils.DB == nil {
		return nil, utils.NewAppError(http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "postgres is not configured")
	}

	if _, err := s.loadUser(req.UserID); err != nil {
		return nil, err
	}

	lookup, err := loadSessionByID(sessionID, req.UserID, false)
	if err != nil {
		return nil, err
	}

	if lookup.expired {
		return nil, utils.NewAppError(http.StatusGone, "SESSION_EXPIRED", "Quiz session has expired.")
	}

	responses := buildSubmitResponsesFromSession(lookup.record)
	if len(responses) == 0 {
		if quit {
			return s.completeSessionWithoutSubmission(sessionID, req.UserID)
		}
		return s.completeSessionWithZeroAnswers(sessionID, req, lookup)
	}

	submitPayload := models.SubmitQuizRequest{
		UserID:     strconv.Itoa(req.UserID),
		RewardType: req.RewardType,
		QuizTime:   strconv.Itoa(req.QuizTimeSeconds),
		Responses:  responses,
	}

	submitResult, err := s.quizService.SubmitQuiz(submitPayload)
	if err != nil {
		return nil, utils.NewAppError(http.StatusBadGateway, "QUIZ_SERVICE_ERROR", err.Error())
	}

	submission, err := extractSubmissionFromResult(submitResult)
	if err != nil {
		return nil, err
	}

	now, err := lagosNow()
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to resolve timezone")
	}

	totalQuestions := lookup.record.TotalQuestions
	if totalQuestions <= 0 {
		totalQuestions = len(submission.Responses)
	}

	correctAnswers := countCorrectResponses(submission)
	baseScore := submission.TotalEarning
	accuracyBonusPercent := getAccuracyBonusPercent(correctAnswers, totalQuestions)
	speedBonusPercent := getSpeedBonusPercent(req.QuizTimeSeconds)
	dailyStreak, err := updateDailyStreak(req.UserID, now)
	if err != nil {
		return nil, err
	}
	streakBonus := getStreakBonusPoints(dailyStreak)

	accuracyGain := int(math.Round(float64(baseScore) * (float64(accuracyBonusPercent) / 100.0)))
	speedGain := int(math.Round(float64(baseScore) * (float64(speedBonusPercent) / 100.0)))
	adBonusPoints := req.AdBonuses
	totalPoints := baseScore + accuracyGain + speedGain + adBonusPoints + streakBonus
	amountInNaira := float64(totalPoints) / 1000.0

	testLevel := lookup.record.TestLevel
	status := "completed"
	if quit {
		status = "quit"
	}

	if err := utils.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.OngoingQuiz{}).
			Where(`"id" = ? AND "userId" = ?`, sessionID, req.UserID).
			Updates(map[string]interface{}{
				"isCompleted":      true,
				"completedAt":      now,
				"totalEarning":     int(math.Round(amountInNaira * 1000)),
				"quizTime":         strconv.Itoa(req.QuizTimeSeconds),
				"baseScore":        baseScore,
				"accuracyBonus":    accuracyGain,
				"speedBonus":       speedGain,
				"streakMultiplier": streakBonus,
				"adBonuses":        adBonusPoints,
				"earnedAmount":     int(math.Round(amountInNaira * 1000)),
				"timeRemaining":    0,
				"updatedAt":        now,
			}).Error; err != nil {
			return err
		}

		if lookup.record.IsRandom {
			if err := tx.Model(&models.QuizAttempt{}).
				Where(`"quizId" = ? AND "userId" = ?`, sessionID, req.UserID).
				Updates(map[string]interface{}{
					"isCompleted": true,
					"completedAt": now,
					"startedAt":   now,
					"expiresAt":   now,
				}).Error; err != nil {
				return err
			}
		}

		for _, item := range submission.Responses {
			if item.Earning <= 0 {
				continue
			}
			accuracyLabel := fmt.Sprintf("%d%%", accuracyBonusPercent)
			quizTime := strconv.Itoa(req.QuizTimeSeconds)
			row := models.QuizLeaderboard{
				UserID:         strconv.Itoa(req.UserID),
				QuizID:         item.QuizID.Hex(),
				Subject:        item.Subject,
				TestLevel:      testLevel,
				Score:          intPtr(submission.Score),
				SelectedAnswer: item.SelectedAnswer,
				QuizTime:       &quizTime,
				AccuracyBonus:  &accuracyLabel,
				CorrectAnswer:  item.CorrectAnswer,
				Earning:        item.Earning,
				SubmittedAt:    submission.SubmittedAt,
				CreatedAt:      now,
				UpdatedAt:      now,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}

		return creditQuizReward(tx, req.UserID, amountInNaira, submission.Subject, submission.Score, totalPoints, now)
	}); err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to finalize quiz session")
	}

	result := map[string]interface{}{
		"sessionId":       sessionID,
		"score":           submission.Score,
		"totalQuestions":  totalQuestions,
		"correctAnswers":  correctAnswers,
		"baseEarning":     baseScore,
		"totalPoints":     totalPoints,
		"amountInNaira":   amountInNaira,
		"rewardType":      req.RewardType,
		"quizTimeSeconds": req.QuizTimeSeconds,
		"submittedAt":     isoTime(submission.SubmittedAt),
		"bonuses": map[string]interface{}{
			"accuracy": map[string]interface{}{"percent": accuracyBonusPercent, "points": accuracyGain},
			"speed":    map[string]interface{}{"percent": speedBonusPercent, "points": speedGain},
			"streak":   map[string]interface{}{"days": dailyStreak, "points": streakBonus},
			"ads":      map[string]interface{}{"points": adBonusPoints},
		},
	}

	streakMessage := "Streak saved! You completed a test just in time"
	if dailyStreak == 3 || dailyStreak == 7 || dailyStreak == 14 || dailyStreak == 30 {
		streakMessage = fmt.Sprintf("🔥 %d-day streak! Bonus applied.", dailyStreak)
	}

	return &models.FinalizeSessionV2Result{
		Result:    result,
		Responses: mapSubmissionResponses(submission),
		Streak: map[string]interface{}{
			"current":     dailyStreak,
			"bonusPoints": streakBonus,
			"flameIcon":   "🔥",
			"message":     streakMessage,
		},
		Session: models.SessionV2Summary{
			ID:     sessionID,
			Status: status,
		},
		Submitted: true,
	}, nil
}

func (s *QuizSessionV2Service) completeSessionWithZeroAnswers(
	sessionID string,
	req models.FinalizeSessionV2Request,
	lookup *activeSessionLookup,
) (*models.FinalizeSessionV2Result, error) {
	now, err := lagosNow()
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to resolve timezone")
	}

	totalQuestions := lookup.record.TotalQuestions
	if totalQuestions <= 0 && len(lookup.record.Questions) > 0 {
		var questions []json.RawMessage
		if err := json.Unmarshal(lookup.record.Questions, &questions); err == nil {
			totalQuestions = len(questions)
		}
	}

	dailyStreak, err := updateDailyStreak(req.UserID, now)
	if err != nil {
		return nil, err
	}
	streakBonus := getStreakBonusPoints(dailyStreak)

	if err := utils.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.OngoingQuiz{}).
			Where(`"id" = ? AND "userId" = ?`, sessionID, req.UserID).
			Updates(map[string]interface{}{
				"isCompleted":      true,
				"completedAt":      now,
				"totalEarning":     0,
				"quizTime":         strconv.Itoa(req.QuizTimeSeconds),
				"baseScore":        0,
				"accuracyBonus":    0,
				"speedBonus":       0,
				"streakMultiplier": streakBonus,
				"adBonuses":        req.AdBonuses,
				"earnedAmount":     0,
				"timeRemaining":    0,
				"updatedAt":        now,
			}).Error; err != nil {
			return err
		}

		if lookup.record.IsRandom {
			if err := tx.Model(&models.QuizAttempt{}).
				Where(`"quizId" = ? AND "userId" = ?`, sessionID, req.UserID).
				Updates(map[string]interface{}{
					"isCompleted": true,
					"completedAt": now,
					"startedAt":   now,
					"expiresAt":   now,
				}).Error; err != nil {
				return err
			}
		}

		return nil
	}); err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to finalize quiz session")
	}

	streakMessage := "Streak saved! You completed a test just in time"
	if dailyStreak == 3 || dailyStreak == 7 || dailyStreak == 14 || dailyStreak == 30 {
		streakMessage = fmt.Sprintf("🔥 %d-day streak! Bonus applied.", dailyStreak)
	}

	result := map[string]interface{}{
		"sessionId":       sessionID,
		"score":           0,
		"totalQuestions":  totalQuestions,
		"correctAnswers":  0,
		"baseEarning":     0,
		"totalPoints":     streakBonus + req.AdBonuses,
		"amountInNaira":   0.0,
		"rewardType":      req.RewardType,
		"quizTimeSeconds": req.QuizTimeSeconds,
		"submittedAt":     isoTime(now),
		"bonuses": map[string]interface{}{
			"accuracy": map[string]interface{}{"percent": 0, "points": 0},
			"speed":    map[string]interface{}{"percent": 0, "points": 0},
			"streak":   map[string]interface{}{"days": dailyStreak, "points": streakBonus},
			"ads":      map[string]interface{}{"points": req.AdBonuses},
		},
	}

	return &models.FinalizeSessionV2Result{
		Result:    result,
		Responses: []map[string]interface{}{},
		Streak: map[string]interface{}{
			"current":     dailyStreak,
			"bonusPoints": streakBonus,
			"flameIcon":   "🔥",
			"message":     streakMessage,
		},
		Session: models.SessionV2Summary{
			ID:     sessionID,
			Status: "completed",
		},
		Submitted: true,
	}, nil
}

func (s *QuizSessionV2Service) completeSessionWithoutSubmission(sessionID string, userID int) (*models.FinalizeSessionV2Result, error) {
	now, err := lagosNow()
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to resolve timezone")
	}

	if err := utils.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.OngoingQuiz{}).
			Where(`"id" = ? AND "userId" = ?`, sessionID, userID).
			Updates(map[string]interface{}{
				"isCompleted":   true,
				"completedAt":   now,
				"timeRemaining": 0,
				"updatedAt":     now,
			}).Error; err != nil {
			return err
		}

		return tx.Model(&models.QuizAttempt{}).
			Where(`"quizId" = ? AND "userId" = ?`, sessionID, userID).
			Updates(map[string]interface{}{
				"isCompleted": true,
				"completedAt": now,
			}).Error
	}); err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to quit quiz session")
	}

	return &models.FinalizeSessionV2Result{
		Result:     nil,
		Responses:  []map[string]interface{}{},
		Streak:     map[string]interface{}{},
		Session:    models.SessionV2Summary{ID: sessionID, Status: "quit"},
		Submitted:  false,
	}, nil
}

func extractSubmissionFromResult(raw map[string]interface{}) (models.QuizSubmission, error) {
	submissionValue, ok := raw["submission"]
	if !ok {
		return models.QuizSubmission{}, utils.NewAppError(http.StatusBadGateway, "QUIZ_SERVICE_ERROR", "Invalid submission response from quiz service")
	}

	if submission, ok := submissionValue.(models.QuizSubmission); ok {
		return submission, nil
	}

	payload, err := json.Marshal(submissionValue)
	if err != nil {
		return models.QuizSubmission{}, utils.NewAppError(http.StatusBadGateway, "QUIZ_SERVICE_ERROR", "Invalid submission response from quiz service")
	}

	var submission models.QuizSubmission
	if err := json.Unmarshal(payload, &submission); err != nil {
		return models.QuizSubmission{}, utils.NewAppError(http.StatusBadGateway, "QUIZ_SERVICE_ERROR", "Invalid submission response from quiz service")
	}

	return submission, nil
}

func updateDailyStreak(userID int, now time.Time) (int, error) {
	var user models.User
	if err := utils.DB.Select("id", "dailyStreak", "lastStreakDate").First(&user, userID).Error; err != nil {
		return 0, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to load user streak")
	}

	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	newStreak := 1

	if user.LastStreakDate != nil {
		last := *user.LastStreakDate
		lastDay := time.Date(last.Year(), last.Month(), last.Day(), 0, 0, 0, 0, last.Location())
		diffDays := int(today.Sub(lastDay).Hours() / 24)
		switch {
		case diffDays == 0:
			return user.DailyStreak, nil
		case diffDays == 1:
			newStreak = user.DailyStreak + 1
		default:
			newStreak = 1
		}
	}

	if err := utils.DB.Model(&models.User{}).
		Where("id = ?", userID).
		Updates(map[string]interface{}{
			"dailyStreak":    newStreak,
			"lastStreakDate": now,
		}).Error; err != nil {
		return 0, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to update daily streak")
	}

	return newStreak, nil
}

func creditQuizReward(tx *gorm.DB, userID int, amountInNaira float64, subject string, score int, totalPoints int, now time.Time) error {
	if amountInNaira <= 0 {
		return nil
	}

	walletAmount := int(math.Round(amountInNaira))
	if walletAmount <= 0 && totalPoints > 0 {
		walletAmount = 1
	}

	if err := tx.Model(&models.Wallet{}).
		Where(`"userId" = ?`, userID).
		UpdateColumn("balance", gorm.Expr(`"balance" + ?`, amountInNaira)).Error; err != nil {
		return err
	}

	trxType := "credit"
	description := fmt.Sprintf("You earned %v from %s Quiz", amountInNaira, subject)
	trxRef := fmt.Sprintf("%d", now.UnixNano())
	if err := tx.Create(&models.WalletTransaction{
		UserID:      userID,
		Amount:      amountInNaira,
		Type:        &trxType,
		Description: &description,
		TrxRef:      &trxRef,
		CreatedAt:   now,
	}).Error; err != nil {
		return err
	}

	if err := tx.Create(&models.Reward{
		ID:        uuid.NewString(),
		UserID:    userID,
		Amount:    walletAmount,
		Currency:  "NGN",
		Type:      "quiz_reward",
		Status:    "PAID_OUT",
		CreatedAt: now,
	}).Error; err != nil {
		return err
	}

	pointRef := fmt.Sprintf("POINTS_%d", now.UnixNano())
	return tx.Create(&models.Point{
		ID:        uuid.NewString(),
		UserID:    userID,
		Points:    score,
		Reference: &pointRef,
		Type:      "quiz_reward",
		CreatedAt: now,
	}).Error
}
