package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/lucsky/cuid"
	"gorm.io/gorm"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/utils"
)

const (
	sessionModeRandom = "random"
	sessionModeCustom = "custom"

	freeDailyQuizLimit = 5
)

// QuizSessionV2Service orchestrates v2 quiz session lifecycle.
type QuizSessionV2Service struct {
	quizService QuizService
}

func NewQuizSessionV2Service(quizService QuizService) *QuizSessionV2Service {
	return &QuizSessionV2Service{quizService: quizService}
}

// CreateSession resolves an active session or creates a new one for POST /v2/quiz/sessions.
func (s *QuizSessionV2Service) CreateSession(req models.CreateSessionV2Request) (*models.CreateSessionV2Result, error) {
	if utils.DB == nil {
		return nil, utils.NewAppError(http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "postgres is not configured")
	}

	if _, err := s.loadUser(req.UserID); err != nil {
		return nil, err
	}

	active, err := loadIncompleteSession(req.UserID)
	if err != nil {
		return nil, err
	}

	if active != nil && !req.ReplaceExisting {
		if active.expired {
			session := mapOngoingQuizToSessionV2(active.record, true)
			return &models.CreateSessionV2Result{
				Session:        session,
				HasOngoingQuiz: true,
				Created:        false,
			}, nil
		}

		if sessionHasStarted(active.record) {
			session := mapOngoingQuizToSessionV2(active.record, false)
			return &models.CreateSessionV2Result{
				Session:        session,
				HasOngoingQuiz: true,
				Created:        false,
			}, nil
		}

		// Ready sessions that were never started get a fresh question set on each request.
		if err := deleteIncompleteSession(active.record.ID, req.UserID); err != nil {
			return nil, err
		}
	}

	if active != nil && req.ReplaceExisting {
		if err := deleteIncompleteSession(active.record.ID, req.UserID); err != nil {
			return nil, err
		}
	}

	return s.createNewSession(req)
}

// GetSession returns a session by id for GET /v2/quiz/sessions/:sessionId.
func (s *QuizSessionV2Service) GetSession(sessionID string, userID int) (*models.SessionV2, error) {
	if utils.DB == nil {
		return nil, utils.NewAppError(http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "postgres is not configured")
	}

	if strings.TrimSpace(sessionID) == "" {
		return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_REQUEST", "sessionId is required")
	}

	if _, err := s.loadUser(userID); err != nil {
		return nil, err
	}

	lookup, err := loadSessionByID(sessionID, userID, false)
	if err != nil {
		return nil, err
	}

	session := mapOngoingQuizToSessionV2(lookup.record, lookup.expired)
	return &session, nil
}

// BeginSession starts the timer for a random session for PATCH /v2/quiz/sessions/:sessionId/begin.
func (s *QuizSessionV2Service) BeginSession(sessionID string, userID int) (*models.SessionV2, error) {
	if utils.DB == nil {
		return nil, utils.NewAppError(http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "postgres is not configured")
	}

	if strings.TrimSpace(sessionID) == "" {
		return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_REQUEST", "sessionId is required")
	}

	if _, err := s.loadUser(userID); err != nil {
		return nil, err
	}

	lookup, err := loadSessionByID(sessionID, userID, false)
	if err != nil {
		return nil, err
	}

	record := lookup.record
	if lookup.expired {
		return nil, utils.NewAppError(http.StatusGone, "SESSION_EXPIRED", "Quiz session has expired.")
	}

	if !record.IsRandom {
		return nil, utils.NewAppError(http.StatusBadRequest, "SESSION_NOT_READY", "Only random quiz sessions require begin.")
	}

	if record.QuizAttempt == nil {
		return nil, utils.NewAppError(http.StatusBadRequest, "SESSION_NOT_READY", "Quiz session is missing start metadata.")
	}

	if record.QuizAttempt.IsStarted {
		return nil, utils.NewAppError(http.StatusBadRequest, "SESSION_NOT_READY", "Session is already in progress.")
	}

	now, err := lagosNow()
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to resolve timezone")
	}

	var expiresAt *time.Time
	if record.TotalTime != nil && *record.TotalTime > 0 {
		expiry := now.Add(time.Duration(*record.TotalTime) * time.Minute)
		expiresAt = &expiry
	}

	timeRemaining := 0
	if record.TotalTime != nil {
		timeRemaining = *record.TotalTime
	}

	if err := utils.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.QuizAttempt{}).
			Where(`"quizId" = ? AND "userId" = ? AND "isStarted" = ?`, sessionID, userID, false).
			Updates(map[string]interface{}{
				"isStarted": true,
				"startedAt": now,
				"expiresAt": expiresAt,
			}).Error; err != nil {
			return fmt.Errorf("update quiz attempt: %w", err)
		}

		if err := tx.Model(&models.OngoingQuiz{}).
			Where(`"id" = ? AND "userId" = ? AND "isCompleted" = ?`, sessionID, userID, false).
			Updates(map[string]interface{}{
				"startedAt":     now,
				"expiresAt":     expiresAt,
				"timeRemaining": timeRemaining,
				"updatedAt":     now,
			}).Error; err != nil {
			return fmt.Errorf("update ongoing quiz: %w", err)
		}

		return nil
	}); err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to begin quiz session")
	}

	updated, err := loadSessionByID(sessionID, userID, false)
	if err != nil {
		return nil, err
	}

	session := mapOngoingQuizToSessionV2(updated.record, false)
	return &session, nil
}

func (s *QuizSessionV2Service) createNewSession(req models.CreateSessionV2Request) (*models.CreateSessionV2Result, error) {
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode != sessionModeRandom && mode != sessionModeCustom {
		return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_REQUEST", "mode must be random or custom when starting a new session")
	}
	if mode == sessionModeCustom && req.Preferences == nil {
		return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_REQUEST", "preferences are required when mode is custom")
	}

	user, err := s.loadUser(req.UserID)
	if err != nil {
		return nil, err
	}

	if err := s.guardDailyLimit(user); err != nil {
		preview, previewErr := s.buildPreviewSession(req, user)
		if previewErr != nil {
			return nil, err
		}
		return nil, utils.NewAppErrorWithData(
			http.StatusTooManyRequests,
			"DAILY_LIMIT_REACHED",
			"Daily quiz limit reached. Upgrade your plan to get more tests.",
			map[string]interface{}{
				"previewSession": preview,
			},
		)
	}

	resolved, err := s.resolvePreferences(mode, user, req.Preferences)
	if err != nil {
		return nil, err
	}

	pack, err := s.quizService.GetQuizByPreferences(
		resolved.language,
		resolved.subject,
		resolved.level,
		resolved.questionPreference,
		resolved.timePreference,
	)
	if err != nil {
		return mapQuizPackError(err)
	}

	quizzes, totalQuestions, totalEarning, totalTimeMinutes, err := extractQuizPack(pack)
	if err != nil {
		return nil, err
	}

	now, err := lagosNow()
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to resolve timezone")
	}

	isRandom := mode == sessionModeRandom
	questionsJSON, err := json.Marshal(quizzes)
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to serialize quiz questions")
	}

	amountInNaira, amountInUSDC, amountInUSDT := computeSessionEarnings(totalEarning)

	var startedAt *time.Time
	var expiresAt *time.Time
	var sessionTotalTime *int

	if resolved.timefree {
		sessionTotalTime = nil
	} else {
		minutes := totalTimeMinutes
		sessionTotalTime = &minutes
		if !isRandom {
			expiry := now.Add(time.Duration(minutes) * time.Minute)
			expiresAt = &expiry
		}
	}

	if !isRandom {
		startedAt = &now
	}

	timeRemaining := 0
	if sessionTotalTime != nil {
		timeRemaining = *sessionTotalTime
	}

	ongoingQuiz := models.OngoingQuiz{
		ID:                  cuid.New(),
		UserID:              req.UserID,
		TestQuiz:            stringField(quizzes[0], "testQuiz"),
		Subject:             stringField(quizzes[0], "subject"),
		TestLevel:           stringField(quizzes[0], "testLevel"),
		TotalEarning:        totalEarning,
		TotalEarninginNaira: intPtr(amountInNaira),
		TotalEarninginUSDC:  intPtr(amountInUSDC),
		TotalEarninginUSDT:  intPtr(amountInUSDT),
		TotalQuestions:      totalQuestions,
		TotalTime:           sessionTotalTime,
		IsRandom:            isRandom,
		TimeRemaining:       timeRemaining,
		Questions:           questionsJSON,
		Answers:             json.RawMessage("[]"),
		CurrentIndex:        0,
		EarnedAmount:        0,
		IsCompleted:         false,
		StartedAt:           startedAt,
		ExpiresAt:           expiresAt,
		CreatedAt:           now,
		UpdatedAt:           now,
	}

	if err := utils.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&ongoingQuiz).Error; err != nil {
			return fmt.Errorf("create ongoing quiz: %w", err)
		}

		if isRandom {
			attempt := models.QuizAttempt{
				UserID:      req.UserID,
				QuizID:      ongoingQuiz.ID,
				IsStarted:   false,
				IsCompleted: false,
			}
			if err := tx.Create(&attempt).Error; err != nil {
				return fmt.Errorf("create quiz attempt: %w", err)
			}
		}

		return nil
	}); err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to create quiz session")
	}

	session := mapOngoingQuizToSessionV2(&ongoingQuiz, false)
	return &models.CreateSessionV2Result{
		Session:        session,
		HasOngoingQuiz: false,
		Created:        true,
	}, nil
}

type resolvedSessionPreferences struct {
	language           string
	subject            string
	level              string
	questionPreference string
	timePreference     string
	timefree           bool
}

func (s *QuizSessionV2Service) loadUser(userID int) (*models.User, error) {
	var user models.User
	err := utils.DB.Select(
		"id",
		"email",
		"subscriptionPlan",
		"languagePreference",
		"subjectPreference",
		"testLevel",
	).First(&user, userID).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_USER", "user not found")
	}
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to load user")
	}

	return &user, nil
}

type activeSessionLookup struct {
	record  *models.OngoingQuiz
	expired bool
}

func loadSessionByID(sessionID string, userID int, allowCompleted bool) (*activeSessionLookup, error) {
	var ongoing models.OngoingQuiz
	query := utils.DB.
		Preload("QuizAttempt").
		Where(`"id" = ?`, sessionID)

	if !allowCompleted {
		query = query.Where(`"isCompleted" = ?`, false)
	}

	err := query.First(&ongoing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, utils.NewAppError(http.StatusNotFound, "SESSION_NOT_FOUND", "Quiz session not found.")
	}
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to load quiz session")
	}

	if ongoing.UserID != userID {
		return nil, utils.NewAppError(http.StatusForbidden, "FORBIDDEN", "Quiz session does not belong to this user.")
	}

	if ongoing.IsCompleted {
		return nil, utils.NewAppError(http.StatusNotFound, "SESSION_NOT_FOUND", "Quiz session not found.")
	}

	return &activeSessionLookup{
		record:  &ongoing,
		expired: isSessionExpired(&ongoing),
	}, nil
}

func loadIncompleteSession(userID int) (*activeSessionLookup, error) {
	var ongoing models.OngoingQuiz
	err := utils.DB.
		Preload("QuizAttempt").
		Where(`"userId" = ? AND "isCompleted" = ?`, userID, false).
		Order(`"createdAt" DESC`).
		First(&ongoing).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to check active session")
	}

	return &activeSessionLookup{
		record:  &ongoing,
		expired: isSessionExpired(&ongoing),
	}, nil
}

func isSessionExpired(record *models.OngoingQuiz) bool {
	now, err := lagosNow()
	if err != nil {
		return false
	}

	if record.IsRandom {
		if record.QuizAttempt == nil {
			return false
		}
		attempt := record.QuizAttempt
		return attempt.IsStarted &&
			attempt.ExpiresAt != nil &&
			!attempt.ExpiresAt.After(now)
	}

	return record.ExpiresAt != nil && !record.ExpiresAt.After(now)
}

func sessionHasStarted(record *models.OngoingQuiz) bool {
	if record == nil {
		return false
	}

	if len(normalizeStoredAnswers(record.Answers)) > 0 {
		return true
	}

	if record.CurrentIndex > 0 {
		return true
	}

	if record.IsRandom {
		return record.QuizAttempt != nil && record.QuizAttempt.IsStarted
	}

	return record.StartedAt != nil
}

func deleteIncompleteSession(sessionID string, userID int) error {
	if err := utils.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where(`"quizId" = ?`, sessionID).Delete(&models.QuizAttempt{}).Error; err != nil {
			return err
		}
		return tx.Where(`"id" = ? AND "userId" = ? AND "isCompleted" = ?`, sessionID, userID, false).
			Delete(&models.OngoingQuiz{}).Error
	}); err != nil {
		return utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to replace active session")
	}
	return nil
}

func (s *QuizSessionV2Service) buildPreviewSession(
	req models.CreateSessionV2Request,
	user *models.User,
) (models.SessionV2, error) {
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode != sessionModeRandom && mode != sessionModeCustom {
		mode = sessionModeRandom
	}

	resolved, err := s.resolvePreferences(mode, user, req.Preferences)
	if err != nil {
		return models.SessionV2{}, err
	}

	pack, err := s.quizService.GetQuizByPreferences(
		resolved.language,
		resolved.subject,
		resolved.level,
		resolved.questionPreference,
		resolved.timePreference,
	)
	if err != nil {
		return models.SessionV2{}, err
	}

	quizzes, totalQuestions, _, totalTimeMinutes, err := extractQuizPack(pack)
	if err != nil {
		return models.SessionV2{}, err
	}

	questionsJSON, err := json.Marshal(quizzes)
	if err != nil {
		return models.SessionV2{}, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to serialize preview quiz questions")
	}

	now, err := lagosNow()
	if err != nil {
		return models.SessionV2{}, err
	}

	isRandom := mode == sessionModeRandom
	var sessionTotalTime *int
	if !resolved.timefree {
		minutes := totalTimeMinutes
		sessionTotalTime = &minutes
	}

	previewRecord := &models.OngoingQuiz{
		ID:             "",
		UserID:         req.UserID,
		TestQuiz:       stringField(quizzes[0], "testQuiz"),
		Subject:        stringField(quizzes[0], "subject"),
		TestLevel:      stringField(quizzes[0], "testLevel"),
		TotalQuestions: totalQuestions,
		TotalTime:      sessionTotalTime,
		IsRandom:       isRandom,
		Questions:      questionsJSON,
		Answers:        json.RawMessage("[]"),
		CurrentIndex:   0,
		IsCompleted:    false,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	session := mapOngoingQuizToSessionV2(previewRecord, false)
	session.Status = "preview"
	session.ID = ""
	return session, nil
}

func (s *QuizSessionV2Service) guardDailyLimit(user *models.User) error {
	plan := ""
	if user.SubscriptionPlan != nil {
		plan = strings.ToUpper(strings.TrimSpace(*user.SubscriptionPlan))
	}
	if plan != "" && plan != "FREE" {
		return nil
	}

	now, err := lagosNow()
	if err != nil {
		return utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to resolve timezone")
	}

	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	endOfDay := startOfDay.Add(24 * time.Hour)

	var completedToday int64
	if err := utils.DB.Model(&models.OngoingQuiz{}).
		Where(`"userId" = ? AND "isCompleted" = ? AND "completedAt" >= ? AND "completedAt" < ?`,
			user.ID, true, startOfDay, endOfDay).
		Count(&completedToday).Error; err != nil {
		return utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to check daily quiz limit")
	}

	if completedToday < freeDailyQuizLimit {
		return nil
	}

	return utils.NewAppError(
		http.StatusTooManyRequests,
		"DAILY_LIMIT_REACHED",
		"Daily quiz limit reached. Upgrade your plan to get more tests.",
	)
}

func (s *QuizSessionV2Service) resolvePreferences(
	mode string,
	user *models.User,
	preferences *models.SessionV2Preferences,
) (*resolvedSessionPreferences, error) {
	resolved := &resolvedSessionPreferences{
		language:           "yoruba",
		subject:            "general",
		level:              "basic",
		questionPreference: "25",
		timePreference:     "5",
	}

	if mode == sessionModeRandom {
		return resolved, nil
	}

	if preferences != nil {
		if lang := strings.TrimSpace(preferences.Language); lang != "" {
			resolved.language = lang
		}
		if subject := strings.TrimSpace(preferences.Subject); subject != "" {
			resolved.subject = subject
		}
		if level := strings.TrimSpace(preferences.Level); level != "" {
			resolved.level = level
		}
		if preferences.QuestionCount > 0 {
			resolved.questionPreference = strconv.Itoa(preferences.QuestionCount)
		}
		if preferences.TimerMinutes == nil {
			resolved.timefree = true
		} else if *preferences.TimerMinutes <= 0 {
			resolved.timefree = true
		} else {
			resolved.timePreference = strconv.Itoa(*preferences.TimerMinutes)
		}
	}

	if preferences == nil ||
		strings.TrimSpace(preferences.Language) == "" ||
		strings.TrimSpace(preferences.Subject) == "" ||
		strings.TrimSpace(preferences.Level) == "" {
		if user.LanguagePreference != nil && strings.TrimSpace(*user.LanguagePreference) != "" {
			resolved.language = strings.TrimSpace(*user.LanguagePreference)
		}
		if user.SubjectPreference != nil && strings.TrimSpace(*user.SubjectPreference) != "" {
			resolved.subject = strings.TrimSpace(*user.SubjectPreference)
		}
		if user.TestLevel != nil && strings.TrimSpace(*user.TestLevel) != "" {
			resolved.level = strings.TrimSpace(*user.TestLevel)
		}
	}

	if resolved.timefree {
		// Question sampling does not depend on timer; use a stable default for pack fetch.
		resolved.timePreference = "5"
	}

	return resolved, nil
}

func extractQuizPack(pack map[string]interface{}) ([]map[string]interface{}, int, int, int, error) {
	rawQuizzes, ok := pack["quizzes"]
	if !ok {
		return nil, 0, 0, 0, utils.NewAppError(http.StatusUnprocessableEntity, "NO_QUIZZES", "quiz pack did not contain any questions")
	}

	payload, err := json.Marshal(rawQuizzes)
	if err != nil {
		return nil, 0, 0, 0, utils.NewAppError(http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "failed to read quiz pack")
	}

	var items []map[string]interface{}
	if err := json.Unmarshal(payload, &items); err != nil || len(items) == 0 {
		return nil, 0, 0, 0, utils.NewAppError(http.StatusUnprocessableEntity, "NO_QUIZZES", "no quizzes available for the selected preferences")
	}

	totalQuestions := len(items)
	if rawTotal, ok := pack["totalQuestions"]; ok {
		switch typed := rawTotal.(type) {
		case int:
			totalQuestions = typed
		case int32:
			totalQuestions = int(typed)
		case int64:
			totalQuestions = int(typed)
		case float64:
			totalQuestions = int(typed)
		}
	}

	totalEarning := 0
	if rawEarning, ok := pack["totalEarning"]; ok {
		switch typed := rawEarning.(type) {
		case int:
			totalEarning = typed
		case int32:
			totalEarning = int(typed)
		case int64:
			totalEarning = int(typed)
		case float64:
			totalEarning = int(typed)
		}
	}
	if totalEarning == 0 {
		for _, quiz := range items {
			if raw := stringField(quiz, "earning"); raw != "" {
				if parsed, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil {
					totalEarning += parsed
				}
			}
		}
	}

	totalTimeMinutes := totalQuestions * 2
	if rawTime, ok := pack["totalTime"]; ok {
		switch typed := rawTime.(type) {
		case int:
			totalTimeMinutes = typed
		case int32:
			totalTimeMinutes = int(typed)
		case int64:
			totalTimeMinutes = int(typed)
		case float64:
			totalTimeMinutes = int(typed)
		}
	}

	return items, totalQuestions, totalEarning, totalTimeMinutes, nil
}

func computeSessionEarnings(totalEarning int) (amountInNaira int, amountInUSDC int, amountInUSDT int) {
	amountInNaira = int(math.Floor(float64(totalEarning) / 1000.0))

	usdcRate := lookupExchangeRate("USDC")
	usdtRate := lookupExchangeRate("USDT")

	if usdcRate > 0 {
		amountInUSDC = int(math.Floor(float64(amountInNaira) / usdcRate))
	}
	if usdtRate > 0 {
		amountInUSDT = int(math.Floor(float64(amountInNaira) / usdtRate))
	}

	return amountInNaira, amountInUSDC, amountInUSDT
}

func lookupExchangeRate(currency string) float64 {
	if utils.DB == nil {
		return 0
	}

	var rate models.ExchangeRate
	err := utils.DB.
		Where(`"fromCurrency" = ?`, strings.ToUpper(strings.TrimSpace(currency))).
		Order(`"updatedAt" DESC`).
		First(&rate).Error
	if err != nil {
		return 0
	}
	return rate.Rate
}

func mapQuizPackError(err error) (*models.CreateSessionV2Result, error) {
	var appErr *utils.AppError
	if errors.As(err, &appErr) {
		return nil, appErr
	}
	return nil, utils.NewAppError(http.StatusBadGateway, "QUIZ_SERVICE_ERROR", err.Error())
}

func intPtr(value int) *int {
	return &value
}
