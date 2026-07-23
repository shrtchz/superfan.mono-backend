package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"gorm.io/gorm"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/utils"
)

// LiveQuizFinaliserInstance is the global finaliser instance.
// Set by main.go at startup so CreateLiveQuiz can schedule timers immediately.
var LiveQuizFinaliserInstance *LiveQuizFinaliser

// ---------------------------------------------------------------------------
// LiveQuizFinaliser finalises a live quiz the instant its finish date arrives.
//
// Instead of polling, each quiz schedules a one-shot callback via time.AfterFunc
// at the moment it is created.  On server startup a single scan catches any
// quizzes that expired while the server was down.
// ---------------------------------------------------------------------------

// LiveQuizFinaliser manages one-shot timers for live quiz finalisation.
type LiveQuizFinaliser struct {
	liveQuizCollection *mongo.Collection
	httpClient         *http.Client
	mu                 sync.Mutex
	timers             map[string]*time.Timer // quiz ID -> timer
	nestBaseURL        string
}

var (
	// ErrQuizAlreadyFinalised is returned when a quiz has already been processed.
	ErrQuizAlreadyFinalised = errors.New("live quiz already finalised")
)

// NewLiveQuizFinaliser creates a finaliser backed by the given MongoDB collection.
func NewLiveQuizFinaliser(liveQuizCollection *mongo.Collection) *LiveQuizFinaliser {
	nestURL := utils.GetEnvWithKey("NEST_BASE_URL")
	if nestURL == "" {
		nestURL = "http://localhost:3000"
	}

	return &LiveQuizFinaliser{
		liveQuizCollection: liveQuizCollection,
		httpClient:         &http.Client{Timeout: 30 * time.Second},
		timers:             make(map[string]*time.Timer),
		nestBaseURL:        nestURL,
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Start loads all existing live quizzes and schedules timers for any that
// haven't been processed yet.  Also immediately finalises any that have
// already expired.
func (f *LiveQuizFinaliser) Start() {
	log.Println("[LiveQuizFinaliser] scanning existing live quizzes at startup")

	now, err := lagosNow()
	if err != nil {
		log.Printf("[LiveQuizFinaliser] failed to get current time: %v", err)
		return
	}

	cursor, err := f.liveQuizCollection.Find(nil, bson.M{})
	if err != nil {
		log.Printf("[LiveQuizFinaliser] MongoDB find error: %v", err)
		return
	}
	defer cursor.Close(nil)

	for cursor.Next(nil) {
		var raw bson.M
		if err := cursor.Decode(&raw); err != nil {
			log.Printf("[LiveQuizFinaliser] decode error: %v", err)
			continue
		}

		quizID := rawObjectIDHex(raw["_id"])
		if quizID == "" {
			continue
		}

		finishAt := rawTime(raw["quizFinishDate"])
		if finishAt.IsZero() {
			continue
		}

		if now.After(finishAt) || now.Equal(finishAt) {
			// Already expired — finalise immediately on a goroutine
			log.Printf("[LiveQuizFinaliser] quiz %s already expired at %s — finalising now", quizID, finishAt.Format(time.RFC3339))
			go f.finaliseQuiz(raw, quizID)
		} else {
			// Schedule a one-shot timer
			f.schedule(quizID, raw, finishAt)
		}
	}

	if err := cursor.Err(); err != nil {
		log.Printf("[LiveQuizFinaliser] cursor error: %v", err)
	}
}

// ScheduleFromCreate is called when a new live quiz is created so a timer
// is set without waiting for the next startup scan.
func (f *LiveQuizFinaliser) ScheduleFromCreate(raw bson.M) {
	quizID := rawObjectIDHex(raw["_id"])
	if quizID == "" {
		return
	}

	finishAt := rawTime(raw["quizFinishDate"])
	if finishAt.IsZero() {
		return
	}

	now, err := lagosNow()
	if err != nil {
		log.Printf("[LiveQuizFinaliser] failed to get time for schedule: %v", err)
		return
	}

	if now.After(finishAt) || now.Equal(finishAt) {
		go f.finaliseQuiz(raw, quizID)
		return
	}

	f.schedule(quizID, raw, finishAt)
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

func (f *LiveQuizFinaliser) schedule(quizID string, raw bson.M, finishAt time.Time) {
	delay := time.Until(finishAt)
	if delay < 0 {
		delay = 0
	}

	f.mu.Lock()
	// Cancel any existing timer for this quiz (e.g. from an update)
	if existing, ok := f.timers[quizID]; ok {
		existing.Stop()
	}
	f.mu.Unlock()

	log.Printf("[LiveQuizFinaliser] scheduling quiz %s to finalise in %v (at %s)",
		quizID, delay.Round(time.Second), finishAt.Format(time.RFC3339))

	timer := time.AfterFunc(delay, func() {
		f.mu.Lock()
		delete(f.timers, quizID)
		f.mu.Unlock()
		f.finaliseQuiz(raw, quizID)
	})

	f.mu.Lock()
	f.timers[quizID] = timer
	f.mu.Unlock()
}

// ---------------------------------------------------------------------------
// Finalisation logic
// ---------------------------------------------------------------------------

func (f *LiveQuizFinaliser) finaliseQuiz(raw bson.M, quizID string) {
	start := time.Now()
	log.Printf("[LiveQuizFinaliser] finalising quiz %s", quizID)

	// Extract quiz details
	correctAnswer := strings.TrimSpace(rawString(raw["answer"]))
	typedAnswer := strings.TrimSpace(rawString(raw["typedAnswer"]))
	isTypedAnswer := rawBool(raw["isTypedAnswer"])
	options := rawStringSlice(raw["options"])
	recipients := rawInt(raw["recipients"])
	unitPrize := rawFloat(raw["unitPrize"])
	question := rawString(raw["question"])

	if correctAnswer == "" && isTypedAnswer {
		correctAnswer = typedAnswer
	}

	if recipients <= 0 {
		log.Printf("[LiveQuizFinaliser] quiz %s has no recipients configured – skipping", quizID)
		return
	}

	if unitPrize <= 0 {
		totalPrize := rawFloat(raw["totalPrize"])
		if totalPrize > 0 && recipients > 0 {
			unitPrize = totalPrize / float64(recipients)
		}
	}

	if utils.DB == nil {
		log.Printf("[LiveQuizFinaliser] postgres not configured – cannot finalise quiz %s", quizID)
		return
	}

	participants, err := f.fetchParticipants(quizID)
	if err != nil {
		log.Printf("[LiveQuizFinaliser] failed to fetch participants for quiz %s: %v", quizID, err)
		return
	}

	if len(participants) == 0 {
		log.Printf("[LiveQuizFinaliser] quiz %s has no participants – skipping", quizID)
		return
	}

	log.Printf("[LiveQuizFinaliser] quiz %s has %d participants", quizID, len(participants))

	// Grade each participant
	type gradedParticipant struct {
		UserID      string
		SubmittedAt time.Time
		Selected    string
	}
	graded := make([]gradedParticipant, 0, len(participants))

	for _, p := range participants {
		isCorrect := gradeAnswer(p.SelectedAnswer, correctAnswer, options)
		if isCorrect {
			graded = append(graded, gradedParticipant{
				UserID:      p.UserID,
				SubmittedAt: p.SubmittedAt,
				Selected:    p.SelectedAnswer,
			})
		}
	}

	log.Printf("[LiveQuizFinaliser] quiz %s – %d/%d correct answers", quizID, len(graded), len(participants))

	// Sort correct answers by submission time (earliest first)
	sort.Slice(graded, func(i, j int) bool {
		return graded[i].SubmittedAt.Before(graded[j].SubmittedAt)
	})

	// Select top N winners
	winners := graded
	if len(winners) > recipients {
		winners = winners[:recipients]
	}

	winnersSet := make(map[string]bool, len(winners))
	for _, w := range winners {
		winnersSet[w.UserID] = true
	}

	rewardAmount := int(math.Round(unitPrize))
	if rewardAmount <= 0 {
		log.Printf("[LiveQuizFinaliser] quiz %s – unitPrize is zero, skipping reward distribution", quizID)
	}

	now, err := lagosNow()
	if err != nil {
		log.Printf("[LiveQuizFinaliser] failed to get current time: %v", err)
		return
	}

	for _, p := range participants {
		isWinner := winnersSet[p.UserID]
		earning := 0
		if isWinner {
			earning = rewardAmount
		}

		// Upsert LiveQuizAttempt
		if err := utils.DB.Where(`"userId" = ? AND "quizId" = ?`, p.UserID, quizID).
			Assign(models.LiveQuizAttempt{
				UserID:      p.UserID,
				QuizID:      quizID,
				Earning:     earning,
				IsWinner:    isWinner,
				IsCompleted: true,
				CompletedAt: &now,
			}).
			FirstOrCreate(&models.LiveQuizAttempt{}).Error; err != nil {
			log.Printf("[LiveQuizFinaliser] failed to upsert attempt for user %s quiz %s: %v", p.UserID, quizID, err)
			continue
		}

		// Credit gold wallet for winners
		if isWinner && rewardAmount > 0 {
			if err := f.creditGoldWallet(p.UserID, rewardAmount, quizID, question, now); err != nil {
				log.Printf("[LiveQuizFinaliser] failed to credit gold wallet for user %s: %v", p.UserID, err)
			}

			// Send notification via NestJS
			if err := f.sendNotification(p.UserID, rewardAmount, question, quizID); err != nil {
				log.Printf("[LiveQuizFinaliser] failed to send notification for user %s: %v", p.UserID, err)
			}
		}
	}

	// Record to leaderboard
	if err := f.recordLeaderboard(quizID, question, correctAnswer, participants, winnersSet, now); err != nil {
		log.Printf("[LiveQuizFinaliser] failed to record leaderboard for quiz %s: %v", quizID, err)
	}

	log.Printf("[LiveQuizFinaliser] quiz %s finalised in %v – %d winners out of %d participants",
		quizID, time.Since(start), len(winners), len(participants))
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

type participantResponse struct {
	UserID         string
	SelectedAnswer string
	SubmittedAt    time.Time
}

func (f *LiveQuizFinaliser) fetchParticipants(quizID string) ([]participantResponse, error) {
	type ongoingSession struct {
		UserID  string
		Answers json.RawMessage `gorm:"column:answers"`
	}

	var sessions []ongoingSession
	if err := utils.DB.Raw(
		`SELECT "userId", "answers" FROM "ongoing_live_quiz" WHERE ? = ANY("quizIds")`,
		quizID,
	).Scan(&sessions).Error; err != nil {
		return nil, fmt.Errorf("query ongoing sessions: %w", err)
	}

	var results []participantResponse
	for _, session := range sessions {
		if len(session.Answers) == 0 {
			continue
		}

		var answers []struct {
			QuizID         string `json:"quizId"`
			SelectedAnswer string `json:"selectedAnswer"`
			SubmittedAt    string `json:"submittedAt"`
		}
		if err := json.Unmarshal(session.Answers, &answers); err != nil {
			continue
		}

		for _, ans := range answers {
			if ans.QuizID == quizID && strings.TrimSpace(ans.SelectedAnswer) != "" {
				submittedAt, _ := time.Parse(time.RFC3339, ans.SubmittedAt)
				if submittedAt.IsZero() {
					submittedAt = time.Now().UTC()
				}
				results = append(results, participantResponse{
					UserID:         session.UserID,
					SelectedAnswer: strings.TrimSpace(ans.SelectedAnswer),
					SubmittedAt:    submittedAt,
				})
			}
		}
	}

	return results, nil
}

func (f *LiveQuizFinaliser) creditGoldWallet(userID string, amount int, quizID, question string, now time.Time) error {
	userIDInt, err := parseInt(userID)
	if err != nil {
		return fmt.Errorf("invalid user ID: %w", err)
	}

	return utils.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Update the main wallet balance
		if err := tx.Model(&models.Wallet{}).
			Where(`"userId" = ?`, userIDInt).
			UpdateColumn("balance", gorm.Expr(`"balance" + ?`, float64(amount))).Error; err != nil {
			return fmt.Errorf("update wallet: %w", err)
		}

		// 2. Create wallet transaction with account_type = 'Gold'
		trxType := "credit"
		description := fmt.Sprintf("You earned ₦%d from Live Quiz: %s", amount, truncate(question, 80))
		trxRef := fmt.Sprintf("LQ_%s_%d", quizID, now.UnixNano())
		if err := tx.Create(&models.WalletTransaction{
			UserID:      userIDInt,
			Amount:      float64(amount),
			Type:        &trxType,
			Description: &description,
			TrxRef:      &trxRef,
			CreatedAt:   now,
		}).Error; err != nil {
			return fmt.Errorf("create wallet transaction: %w", err)
		}

		// 3. Create Reward record
		if err := tx.Create(&models.Reward{
			ID:        uuid.NewString(),
			UserID:    userIDInt,
			Amount:    amount,
			Currency:  "NGN",
			Type:      "live_quiz_reward",
			Status:    "PAID_OUT",
			CreatedAt: now,
		}).Error; err != nil {
			return fmt.Errorf("create reward: %w", err)
		}

		// 4. Insert into activity wallet table (optional but matches Nest pattern)
		if tx.Migrator().HasTable("ActivityWallet") {
			if err := tx.Exec(
				`INSERT INTO "ActivityWallet" ("userId", "type", "title", "description", "amount", "currency", "status", "createdAt")
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				userIDInt, "credit",
				fmt.Sprintf("₦%d has been added to your wallet", amount),
				fmt.Sprintf("You earned ₦%d from Live Quiz", amount),
				float64(amount), "NGN", "SUCCESS", now,
			).Error; err != nil {
				log.Printf("[LiveQuizFinaliser] activity wallet insert warning: %v", err)
			}
		}

		return nil
	})
}

func (f *LiveQuizFinaliser) sendNotification(userID string, amount int, question, quizID string) error {
	userIDInt, err := parseInt(userID)
	if err != nil {
		return fmt.Errorf("invalid user ID for notification: %w", err)
	}

	payload := map[string]interface{}{
		"userId":  userIDInt,
		"title":   fmt.Sprintf("🎉 You won ₦%d from Live Quiz!", amount),
		"message": fmt.Sprintf("Congratulations! You got the correct answer for \"%s\" and earned ₦%d.", truncate(question, 60), amount),
		"type":    "live_quiz_reward",
		"data": map[string]interface{}{
			"quizId": quizID,
			"amount": amount,
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal notification payload: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/notifications/create", f.nestBaseURL)
	resp, err := f.httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("http post to nest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("nest returned status %d", resp.StatusCode)
	}

	return nil
}

func (f *LiveQuizFinaliser) recordLeaderboard(quizID, question, correctAnswer string, participants []participantResponse, winnersSet map[string]bool, now time.Time) error {
	for _, p := range participants {
		isWinner := winnersSet[p.UserID]
		earning := 0
		if isWinner {
			earning = 1
		}

		entry := models.QuizLeaderboard{
			UserID:         p.UserID,
			QuizID:         quizID,
			Subject:        "live-quiz",
			TestLevel:      "live",
			SelectedAnswer: p.SelectedAnswer,
			CorrectAnswer:  correctAnswer,
			Earning:        earning,
			SubmittedAt:    p.SubmittedAt,
			CreatedAt:      now,
			UpdatedAt:      now,
		}

		if err := utils.DB.Create(&entry).Error; err != nil {
			log.Printf("[LiveQuizFinaliser] leaderboard insert error for user %s quiz %s: %v", p.UserID, quizID, err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func parseInt(s string) (int, error) {
	var n int
	_, err := fmt.Sscanf(strings.TrimSpace(s), "%d", &n)
	return n, err
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}