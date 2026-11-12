package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"math/rand"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"gorm.io/gorm"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/utils"
)

type QuizServiceImpl struct {
	quizcollection           *mongo.Collection
	quizCategoryCollection   *mongo.Collection
	liveQuizCollection       *mongo.Collection
	quizSubmissionCollection *mongo.Collection
	ctx                      context.Context
}

var ErrLiveQuizActive = errors.New("live quiz is active")
var ErrLiveQuizOverlap = errors.New("another live quiz is already scheduled or active")

// type QuizSubmissionServiceImpl struct {
// 	collection *mongo.Collection
// 	ctx        context.Context
// }

func NewQuizService(quizcollection *mongo.Collection, quizCategoryCollection *mongo.Collection, liveQuizCollection *mongo.Collection, quizSubmissionCollection *mongo.Collection, ctx context.Context) QuizService {
	return &QuizServiceImpl{
		quizcollection:           quizcollection,
		quizCategoryCollection:   quizCategoryCollection,
		quizSubmissionCollection: quizSubmissionCollection,
		liveQuizCollection:       liveQuizCollection,
		ctx:                      ctx,
	}
}

func lagosLocation() *time.Location {
	location, err := time.LoadLocation("Africa/Lagos")
	if err != nil {
		// Alpine images without tzdata fail LoadLocation; WAT is fixed UTC+1 (no DST).
		return time.FixedZone("WAT", 3600)
	}
	return location
}

func lagosNow() (time.Time, error) {
	return time.Now().In(lagosLocation()), nil
}

func ComputeLiveQuizStatus(startAt, finishAt, now time.Time) string {
	if now.Before(startAt) {
		return "scheduled"
	}
	if (now.Equal(startAt) || now.After(startAt)) && now.Before(finishAt) {
		return "live"
	}
	return "closed"
}

func formatLiveQuizCountdown(target, now time.Time) string {
	if target.Before(now) {
		return "0s"
	}

	remaining := target.Sub(now).Round(time.Second)
	totalSeconds := int(remaining / time.Second)
	if totalSeconds < 0 {
		totalSeconds = 0
	}

	hours := totalSeconds / 3600
	minutes := (totalSeconds % 3600) / 60
	seconds := totalSeconds % 60

	parts := make([]string, 0, 3)
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	if minutes > 0 {
		parts = append(parts, fmt.Sprintf("%dm", minutes))
	}
	if seconds > 0 || len(parts) == 0 {
		parts = append(parts, fmt.Sprintf("%ds", seconds))
	}

	return strings.Join(parts, " ")
}

func formatLiveQuizElapsed(target, now time.Time) string {
	if now.Before(target) {
		return "just now"
	}

	elapsed := now.Sub(target)
	hours := int(elapsed.Hours())
	if hours >= 1 {
		if hours == 1 {
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", hours)
	}

	minutes := int(elapsed.Minutes())
	if minutes >= 1 {
		if minutes == 1 {
			return "1 minute ago"
		}
		return fmt.Sprintf("%d minutes ago", minutes)
	}

	seconds := int(elapsed.Seconds())
	if seconds <= 1 {
		return "just now"
	}
	return fmt.Sprintf("%d seconds ago", seconds)
}

func resolveQuizCountdownLabel(defaultLabel, phase, overrideBefore, overrideDuring, overrideAfter string) string {
	return strings.TrimSpace(defaultLabel)
}

func BuildLiveQuizCountdownLabel(startAt, finishAt time.Time, now time.Time, overrideBefore, overrideDuring, overrideAfter string) string {
	if startAt.IsZero() || finishAt.IsZero() {
		return resolveQuizCountdownLabel("Waiting for Live Quiz to start.", "before", overrideBefore, overrideDuring, overrideAfter)
	}

	var defaultLabel string
	var phase string

	switch ComputeLiveQuizStatus(startAt, finishAt, now) {
	case "scheduled":
		defaultLabel = fmt.Sprintf(
			"Waiting for Live Quiz to start in %s.",
			formatLiveQuizCountdown(startAt, now),
		)
		phase = "before"
	case "live":
		defaultLabel = "To answer, tap the three dots next to the live quiz."
		phase = "during"
	default:
		defaultLabel = fmt.Sprintf(
			"The quiz window closed %s.",
			formatLiveQuizElapsed(finishAt, now),
		)
		phase = "after"
	}

	return resolveQuizCountdownLabel(defaultLabel, phase, overrideBefore, overrideDuring, overrideAfter)
}

func buildParticipantCandidatesFromAttempts(attempts []models.LiveQuizAttempt) []map[string]interface{} {
	participants := make([]map[string]interface{}, 0, len(attempts))
	winnerRank := 0
	for _, attempt := range attempts {
		rank := 0
		if attempt.IsWinner {
			winnerRank++
			rank = winnerRank
		}
		userName := attempt.UserID
		fullName := attempt.UserID
		firstName := attempt.UserID
		lastName := ""
		profilePicture := ""

		if userID, err := strconv.Atoi(strings.TrimSpace(attempt.UserID)); err == nil {
			var user models.User
			if err := utils.DB.Where(`"id" = ?`, userID).First(&user).Error; err == nil {
				var clerkUserID string
				if user.ClerkUserID != nil {
					clerkUserID = *user.ClerkUserID
				}
				if user.ProfilePicture != nil {
					profilePicture = *user.ProfilePicture
				}
				if trimmed := strings.TrimSpace(user.FirstName); trimmed != "" {
					firstName = trimmed
				}
				if trimmed := strings.TrimSpace(user.LastName); trimmed != "" {
					lastName = trimmed
				}
				if trimmed := strings.TrimSpace(user.Username); trimmed != "" {
					userName = trimmed
				}
				if trimmed := strings.TrimSpace(user.Email); trimmed != "" {
					if fullName == attempt.UserID {
						fullName = trimmed
					}
					if userName == attempt.UserID {
						userName = trimmed
					}
				}
				if trimmed := strings.TrimSpace(clerkUserID); trimmed != "" {
					if userName == attempt.UserID {
						userName = trimmed
					}
					if fullName == attempt.UserID {
						fullName = trimmed
					}
				}
				if trimmed := strings.TrimSpace(strings.TrimSpace(firstName) + " " + strings.TrimSpace(lastName)); trimmed != "" {
					fullName = trimmed
				}
				if profilePicture != "" {
					// keep profile image in payload if available
				}
			}
		}

		participants = append(participants, map[string]interface{}{
			"id":        attempt.UserID,
			"userId":    attempt.UserID,
			"username":  userName,
			"fullname":  fullName,
			"firstName": firstName,
			"lastName":  lastName,
			"image":     profilePicture,
			"amountWon": attempt.Earning,
			"rank":      rank,
			"isWinner":  attempt.IsWinner,
		})
	}
	return participants
}

func buildTopWinnerCandidatesFromAttempts(attempts []models.LiveQuizAttempt) []map[string]interface{} {
	participants := buildParticipantCandidatesFromAttempts(attempts)
	winners := make([]map[string]interface{}, 0, len(participants))
	for _, participant := range participants {
		if participant["isWinner"] == true {
			winners = append(winners, participant)
		}
	}
	return winners
}

func buildLiveQuizLedgerMeta(quizID string, status string) map[string]interface{} {
	meta := map[string]interface{}{
		"participants":          0,
		"winnerCount":           0,
		"topWinners":            []map[string]interface{}{},
		"attemptedParticipants": []map[string]interface{}{},
		"rewardStatus":          "pending",
		"payoutStatus":          "pending",
	}

	if strings.TrimSpace(quizID) == "" {
		return meta
	}

	var attempts []models.LiveQuizAttempt
	if err := utils.DB.Where(`"quizId" = ?`, quizID).Order(`"createdAt" ASC`).Find(&attempts).Error; err == nil && len(attempts) > 0 {
		meta["participants"] = len(attempts)
		winnerCount := 0
		paid := false
		for _, attempt := range attempts {
			if attempt.IsWinner {
				winnerCount++
			}
			if attempt.IsCompleted && attempt.Earning > 0 {
				paid = true
			}
		}
		meta["winnerCount"] = winnerCount
		attemptedParticipants := buildParticipantCandidatesFromAttempts(attempts)
		meta["attemptedParticipants"] = attemptedParticipants
		topWinners := make([]map[string]interface{}, 0, winnerCount)
		for _, participant := range attemptedParticipants {
			if participant["isWinner"] == true {
				topWinners = append(topWinners, participant)
			}
		}
		meta["topWinners"] = topWinners
		if strings.EqualFold(status, "closed") && paid {
			meta["rewardStatus"] = "paid"
			meta["payoutStatus"] = "paid"
			return meta
		}
		return meta
	}

	var leaderboardRows []models.LiveQuizLeaderboardRow
	if err := utils.DB.Where(`"quizId" = ?`, quizID).Order(`"createdAt" DESC`).Find(&leaderboardRows).Error; err == nil && len(leaderboardRows) > 0 {
		participantCount := 0
		winnerCount := 0
		topWinners := make([]map[string]interface{}, 0)
		attemptedParticipants := make([]map[string]interface{}, 0, len(leaderboardRows))
		for _, row := range leaderboardRows {
			if row.Participants > participantCount {
				participantCount = row.Participants
			}
			rank := 0
			if row.IsWinner {
				winnerCount++
				rank = winnerCount
			}
			participant := map[string]interface{}{
				"id":        row.UserID,
				"userId":    row.UserID,
				"username":  row.UserID,
				"fullname":  row.UserID,
				"firstName": row.UserID,
				"lastName":  "",
				"image":     nil,
				"amountWon": 0,
				"rank":      rank,
				"isWinner":  row.IsWinner,
			}
			attemptedParticipants = append(attemptedParticipants, participant)
			if row.IsWinner {
				topWinners = append(topWinners, participant)
			}
		}
		meta["participants"] = participantCount
		meta["winnerCount"] = winnerCount
		meta["topWinners"] = topWinners
		meta["attemptedParticipants"] = attemptedParticipants
		rewardStatus := strings.ToLower(strings.TrimSpace(leaderboardRows[0].RewardStatus))
		if rewardStatus == "" {
			rewardStatus = "pending"
		}
		meta["rewardStatus"] = rewardStatus
		meta["payoutStatus"] = rewardStatus
		return meta
	}

	var sessions []struct {
		UserID  string          `gorm:"column:userId"`
		Answers json.RawMessage `gorm:"column:answers"`
	}
	if err := utils.DB.Raw(`SELECT "userId", "answers" FROM "ongoing_live_quiz" WHERE ? = ANY("quizIds")`, quizID).Scan(&sessions).Error; err == nil {
		participantSet := make(map[string]struct{})
		attemptedParticipants := make([]map[string]interface{}, 0)
		for _, session := range sessions {
			if len(session.Answers) == 0 {
				continue
			}
			var answers []struct {
				QuizID         string `json:"quizId"`
				SelectedAnswer string `json:"selectedAnswer"`
			}
			if err := json.Unmarshal(session.Answers, &answers); err != nil {
				continue
			}
			for _, answer := range answers {
				if answer.QuizID == quizID && strings.TrimSpace(answer.SelectedAnswer) != "" {
					if _, exists := participantSet[session.UserID]; exists {
						continue
					}
					participantSet[session.UserID] = struct{}{}
					attemptedParticipants = append(attemptedParticipants, map[string]interface{}{
						"id":        session.UserID,
						"userId":    session.UserID,
						"username":  session.UserID,
						"fullname":  session.UserID,
						"firstName": session.UserID,
						"lastName":  "",
						"rank":      0,
						"isWinner":  false,
					})
				}
			}
		}
		meta["participants"] = len(participantSet)
		meta["attemptedParticipants"] = attemptedParticipants
	}

	return meta
}

func buildLiveQuizResponseMap(raw bson.M, now time.Time) map[string]interface{} {
	id := rawObjectIDHex(raw["_id"])
	startAt := rawTime(raw["quizScheduleDate"])
	finishAt := rawTime(raw["quizFinishDate"])
	status := "scheduled"
	if !startAt.IsZero() && !finishAt.IsZero() {
		status = ComputeLiveQuizStatus(startAt, finishAt, now)
	}
	jackpotAmount := rawFloat(raw["jackpotAmount"])
	if jackpotAmount <= 0 {
		jackpotAmount = rawFloat(raw["totalPrize"])
	}
	isActive := status == "live"

	overrideBefore := rawString(raw["customCountdownLabelBefore"])
	if overrideBefore == "" {
		overrideBefore = rawString(raw["customCountdownLabel"])
	}
	overrideDuring := rawString(raw["customCountdownLabelDuring"])
	if overrideDuring == "" {
		overrideDuring = rawString(raw["customCountdownLabel"])
	}
	overrideAfter := rawString(raw["customCountdownLabelAfter"])
	if overrideAfter == "" {
		overrideAfter = rawString(raw["customCountdownLabel"])
	}
	customCountdownLabels := rawCustomCountdownLabels(raw["customCountdownLabels"], overrideBefore, overrideDuring, overrideAfter)

	ledgerMeta := buildLiveQuizLedgerMeta(id, status)

	return map[string]interface{}{
		"id":                         id,
		"question":                   rawString(raw["question"]),
		"options":                    rawStringSlice(raw["options"]),
		"answer":                     rawString(raw["answer"]),
		"typedAnswer":                rawString(raw["typedAnswer"]),
		"isTypedAnswer":              rawBool(raw["isTypedAnswer"]),
		"jackpotAmount":              jackpotAmount,
		"totalPrize":                 rawFloat(raw["totalPrize"]),
		"recipients":                 rawInt(raw["recipients"]),
		"unitPrize":                  rawFloat(raw["unitPrize"]),
		"showAnswer":                 rawBool(raw["showAnswer"]),
		"quizScheduleDate":           rawTimeString(raw["quizScheduleDate"]),
		"quizFinishDate":             rawTimeString(raw["quizFinishDate"]),
		"status":                     status,
		"isEditable":                 !isActive,
		"isDeletable":                !isActive,
		"imageLink":                  rawStringSlice(raw["imageLink"]),
		"quizCountdownState":         status,
		"quizCountdownLabel":         BuildLiveQuizCountdownLabel(startAt, finishAt, now, overrideBefore, overrideDuring, overrideAfter),
		"customCountdownLabel":       strings.TrimSpace(rawString(raw["customCountdownLabel"])),
		"customCountdownLabelBefore": strings.TrimSpace(overrideBefore),
		"customCountdownLabelDuring": strings.TrimSpace(overrideDuring),
		"customCountdownLabelAfter":  strings.TrimSpace(overrideAfter),
		"customCountdownLabels":      customCountdownLabels,
		"participants":               ledgerMeta["participants"],
		"winnerCount":                ledgerMeta["winnerCount"],
		"topWinners":                 ledgerMeta["topWinners"],
		"attemptedParticipants":      ledgerMeta["attemptedParticipants"],
		"rewardStatus":               ledgerMeta["rewardStatus"],
		"payoutStatus":               ledgerMeta["payoutStatus"],
	}
}

// func NewQuizSubmissionService(collection *mongo.Collection, ctx context.Context) QuizSubmissionService {
// 	return &QuizServiceImpl{
// 		quizSubmissionCollection: collection,
// 		ctx:                      ctx,
// 	}
// }

func (u *QuizServiceImpl) CreateQuiz(quiz *models.Quiz) error {
	if err := validateQuizMediaUrls(quiz.ImageLink); err != nil {
		return err
	}

	// Basic validation
	if quiz.TestQuiz == "" {
		return errors.New("testQuiz is required")
	}

	if quiz.TestLevel == "" {
		return errors.New("testLevel is required")
	}

	if quiz.Subject == "" {
		return errors.New("subject is required")
	}

	if quiz.Question == "" {
		return errors.New("question is required")
	}

	// if len(quiz.Options) < 4 {
	// 	return errors.New("at least four options are required")
	// }

	if quiz.Answer == "" {
		return errors.New("answer is required")
	}

	// Normalize strings (optional but recommended)
	quiz.TestQuiz = strings.ToLower(strings.TrimSpace(quiz.TestQuiz))
	quiz.TestLevel = strings.ToLower(strings.TrimSpace(quiz.TestLevel))
	quiz.Subject = strings.ToLower(strings.TrimSpace(quiz.Subject))

	// Assign earning based on testLevel (string-based)
	switch quiz.TestLevel {
	case "basic", "easy":
		quiz.Earning = "400"
		quiz.TestLevel = "basic"
	case "intermediate", "medium":
		quiz.Earning = "600"
		quiz.TestLevel = "intermediate"
	case "advanced", "hard":
		quiz.Earning = "800"
		quiz.TestLevel = "advanced"
	default:
		if strings.TrimSpace(quiz.Earning) == "" {
			quiz.Earning = "600"
		}
	}

	// Generate ID
	if quiz.ID.IsZero() {
		quiz.ID = bson.NewObjectID()
	}
	quiz.IDHex = quiz.ID.Hex()

	_, err := u.quizcollection.InsertOne(u.ctx, quiz)
	return err
}

func (u *QuizServiceImpl) CreateLiveQuiz(liveQuiz *models.LiveQuiz) error {
	// Validate required fields
	if liveQuiz.Question == "" {
		return errors.New("question is required")
	}

	// Conditional validation:
	// - If typed answer is enabled, TypedAnswer must be provided and options may be empty.
	// - If typed answer is disabled, at least one option must be provided and TypedAnswer is ignored.
	if liveQuiz.IsTypedAnswer {
		if strings.TrimSpace(liveQuiz.TypedAnswer) == "" {
			return errors.New("typed answer is required")
		}
	} else {
		if len(liveQuiz.Options) == 0 {
			return errors.New("options are required")
		}
	}

	if liveQuiz.TotalPrize <= 0 {
		return errors.New("total prize is required")
	}

	if liveQuiz.Recipients <= 0 {
		return errors.New("recipients is required")
	}

	if liveQuiz.UnitPrize <= 0 {
		return errors.New("unit prize is required")
	}

	if !liveQuiz.IsTypedAnswer && liveQuiz.Answer == "" {
		return errors.New("answer is required")
	}

	if liveQuiz.QuizScheduleDate.IsZero() {
		return errors.New("quiz schedule date is required")
	}
	if liveQuiz.QuizFinishDate.IsZero() {
		return errors.New("quiz finish date is required")
	}
	if !liveQuiz.QuizFinishDate.After(liveQuiz.QuizScheduleDate) {
		return errors.New("quiz finish date must be after quiz schedule date")
	}

	overlapped, err := u.hasOverlappingLiveQuiz(liveQuiz.QuizScheduleDate, liveQuiz.QuizFinishDate)
	if err != nil {
		return err
	}
	if overlapped {
		return ErrLiveQuizOverlap
	}

	if liveQuiz.JackpotAmount <= 0 {
		liveQuiz.JackpotAmount = liveQuiz.TotalPrize
	}
	if liveQuiz.TotalPrize <= 0 && liveQuiz.JackpotAmount > 0 {
		liveQuiz.TotalPrize = liveQuiz.JackpotAmount
	}

	// Generate MongoDB ObjectID
	liveQuiz.ID = bson.NewObjectID()
	liveQuiz.IDHex = liveQuiz.ID.Hex()

	doc := bson.M{
		"_id":                  liveQuiz.ID,
		"question":             liveQuiz.Question,
		"options":              liveQuiz.Options,
		"answer":               liveQuiz.Answer,
		"customCountdownLabel": strings.TrimSpace(liveQuiz.CustomCountdownLabel),
		"isTypedAnswer":        liveQuiz.IsTypedAnswer,
		"typedAnswer":          liveQuiz.TypedAnswer,
		"jackpotAmount":        liveQuiz.JackpotAmount,
		"totalPrize":           liveQuiz.TotalPrize,
		"recipients":           liveQuiz.Recipients,
		"unitPrize":            liveQuiz.UnitPrize,
		"showAnswer":           liveQuiz.ShowAnswer,
		"quizScheduleDate":     liveQuiz.QuizScheduleDate,
		"quizFinishDate":       liveQuiz.QuizFinishDate,
		"imageLink":            liveQuiz.ImageLink,
	}

	_, err = u.liveQuizCollection.InsertOne(u.ctx, doc)
	if err == nil && LiveQuizFinaliserInstance != nil {
		// Schedule the one-shot timer for when this quiz expires
		LiveQuizFinaliserInstance.ScheduleFromCreate(doc)
	}
	return err
}

func (u *QuizServiceImpl) GetLiveQuiz(id string) (*models.LiveQuiz, error) {
	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, errors.New("invalid id format")
	}

	var liveQuiz models.LiveQuiz

	filter := bson.M{"_id": objectId}

	err = u.liveQuizCollection.FindOne(u.ctx, filter).Decode(&liveQuiz)
	if err != nil {
		return nil, err
	}

	liveQuiz.IDHex = liveQuiz.ID.Hex()
	return &liveQuiz, nil
}

func (u *QuizServiceImpl) GetRandomLiveQuiz(number string) ([]models.LiveQuiz, error) {
	limit, err := strconv.Atoi(strings.TrimSpace(number))
	if err != nil || limit <= 0 {
		return nil, errors.New("invalid quiz number")
	}

	now, err := lagosNow()
	if err != nil {
		return nil, err
	}

	pipeline := mongo.Pipeline{
		// Stage 1: Filter to only active quizzes (start reached, finish not reached)
		{
			{Key: "$match", Value: bson.M{
				"quizScheduleDate": bson.M{"$lte": now},
				"quizFinishDate":   bson.M{"$gt": now},
			}},
		},
		// Stage 2: Randomly sample 'limit' documents
		{
			{Key: "$sample", Value: bson.M{"size": limit}},
		},
		// Stage 3: Exclude sensitive fields
		{
			{Key: "$project", Value: bson.M{
				"answer":      0,
				"typedAnswer": 0,
			}},
		},
	}

	cursor, err := u.liveQuizCollection.Aggregate(u.ctx, pipeline)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(u.ctx)

	var quizzes []models.LiveQuiz
	if err := cursor.All(u.ctx, &quizzes); err != nil {
		return nil, err
	}

	if len(quizzes) == 0 {
		return nil, errors.New("no active live quizzes found")
	}

	for i := range quizzes {
		quizzes[i].IDHex = quizzes[i].ID.Hex()
	}

	return quizzes, nil
}

func (u *QuizServiceImpl) hasOverlappingLiveQuiz(startAt, finishAt time.Time) (bool, error) {
	if u.liveQuizCollection == nil {
		return false, errors.New("live quiz collection not configured")
	}

	filter := bson.M{
		"quizScheduleDate": bson.M{"$lt": finishAt},
		"quizFinishDate":   bson.M{"$gt": startAt},
	}
	count, err := u.liveQuizCollection.CountDocuments(u.ctx, filter)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (u *QuizServiceImpl) GetAllLiveQuiz() ([]map[string]interface{}, error) {
	liveQuizzes := make([]map[string]interface{}, 0)
	now, _ := lagosNow()

	// Admin ledger: return every live quiz (past + upcoming). Player-facing
	// "active only" filtering stays on GetRandomLiveQuiz.
	ctx := context.Background()
	opts := options.Find().SetSort(bson.D{{Key: "quizScheduleDate", Value: -1}})
	cursor, err := u.liveQuizCollection.Find(ctx, bson.D{}, opts)
	if err != nil {
		return liveQuizzes, err
	}
	defer cursor.Close(ctx)

	for cursor.Next(ctx) {
		// Decode into a raw doc so older int/string prize fields still load.
		var raw bson.M
		if err := cursor.Decode(&raw); err != nil {
			log.Printf("GetAllLiveQuiz: skip doc decode error: %v", err)
			continue
		}

		liveQuizzes = append(liveQuizzes, buildLiveQuizResponseMap(raw, now))
	}

	if err := cursor.Err(); err != nil {
		return liveQuizzes, err
	}

	return liveQuizzes, nil
}

func rawString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", t)
	}
}

func rawCustomCountdownLabels(value interface{}, before, during, after string) []map[string]string {
	labels := make([]map[string]string, 0)
	if encoded, err := json.Marshal(value); err == nil {
		_ = json.Unmarshal(encoded, &labels)
	}
	if len(labels) > 0 {
		return labels
	}
	legacy := []struct {
		id, phase, text string
	}{
		{"legacy-before", "before", before},
		{"legacy-during", "during", during},
		{"legacy-after", "after", after},
	}
	for _, item := range legacy {
		if strings.TrimSpace(item.text) != "" {
			labels = append(labels, map[string]string{
				"id": item.id, "phase": item.phase, "text": strings.TrimSpace(item.text),
			})
		}
	}
	return labels
}

func rawBool(v interface{}) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(t, "true") || t == "1"
	case int32:
		return t != 0
	case int64:
		return t != 0
	case float64:
		return t != 0
	default:
		return false
	}
}

func rawInt(v interface{}) int {
	switch t := v.(type) {
	case int:
		return t
	case int32:
		return int(t)
	case int64:
		return int(t)
	case float64:
		return int(t)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(t))
		return n
	default:
		return 0
	}
}

func rawFloat(v interface{}) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int32:
		return float64(t)
	case int64:
		return float64(t)
	case string:
		n, _ := strconv.ParseFloat(strings.TrimSpace(t), 64)
		return n
	default:
		return 0
	}
}

func rawStringSlice(v interface{}) []string {
	switch t := v.(type) {
	case []string:
		return t
	case bson.A:
		out := make([]string, 0, len(t))
		for _, item := range t {
			s := strings.TrimSpace(rawString(item))
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	case []interface{}:
		out := make([]string, 0, len(t))
		for _, item := range t {
			s := strings.TrimSpace(rawString(item))
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

func rawObjectIDHex(v interface{}) string {
	switch t := v.(type) {
	case bson.ObjectID:
		return t.Hex()
	case string:
		return t
	default:
		return ""
	}
}

func rawTimeString(v interface{}) string {
	switch t := v.(type) {
	case time.Time:
		if t.IsZero() {
			return ""
		}
		return t.UTC().Format(time.RFC3339)
	case string:
		return strings.TrimSpace(t)
	case int64:
		// BSON datetime milliseconds
		return time.UnixMilli(t).UTC().Format(time.RFC3339)
	case float64:
		return time.UnixMilli(int64(t)).UTC().Format(time.RFC3339)
	default:
		// Handle bson.DateTime and similar via fmt without importing driver-specific aliases
		if tm, ok := v.(interface{ Time() time.Time }); ok {
			tt := tm.Time()
			if tt.IsZero() {
				return ""
			}
			return tt.UTC().Format(time.RFC3339)
		}
		return ""
	}
}

func rawTime(v interface{}) time.Time {
	switch t := v.(type) {
	case time.Time:
		return t
	case string:
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(t))
		if err == nil {
			return parsed
		}
		return time.Time{}
	case int64:
		return time.UnixMilli(t)
	case float64:
		return time.UnixMilli(int64(t))
	default:
		if tm, ok := v.(interface{ Time() time.Time }); ok {
			return tm.Time()
		}
		return time.Time{}
	}
}

type QuizResponse struct {
	ID        string      `json:"id"`
	TestQuiz  string      `json:"testQuiz"`
	Earning   string      `json:"earning"`
	Subject   string      `json:"subject"`
	TestLevel string      `json:"testLevel"`
	Question  string      `json:"question"`
	ImageLink []string    `json:"imageLink"`
	Options   interface{} `json:"options"`
}

func (u *QuizServiceImpl) sampleQuizzes(matchConditions bson.D, size int) ([]QuizResponse, error) {
	if size <= 0 {
		return nil, nil
	}
	var pipeline mongo.Pipeline
	if len(matchConditions) > 0 {
		pipeline = mongo.Pipeline{
			bson.D{{Key: "$match", Value: matchConditions}},
			bson.D{{Key: "$sample", Value: bson.D{{Key: "size", Value: size}}}},
		}
	} else {
		pipeline = mongo.Pipeline{
			bson.D{{Key: "$sample", Value: bson.D{{Key: "size", Value: size}}}},
		}
	}

	cursor, err := u.quizcollection.Aggregate(u.ctx, pipeline)
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "DB_ERROR",
			fmt.Sprintf("aggregation error: %v", err))
	}
	defer cursor.Close(u.ctx)

	var list []QuizResponse
	for cursor.Next(u.ctx) {
		var quiz models.Quiz
		if err := cursor.Decode(&quiz); err != nil {
			return nil, utils.NewAppError(http.StatusInternalServerError, "DECODE_ERROR",
				fmt.Sprintf("failed to decode quiz: %v", err))
		}
		list = append(list, QuizResponse{
			ID:        quiz.ID.Hex(),
			TestQuiz:  quiz.TestQuiz,
			Earning:   quiz.Earning,
			Subject:   quiz.Subject,
			TestLevel: quiz.TestLevel,
			Question:  quiz.Question,
			ImageLink: quiz.ImageLink,
			Options:   quiz.Options,
		})
	}

	if err := cursor.Err(); err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "CURSOR_ERROR",
			fmt.Sprintf("cursor error: %v", err))
	}

	return list, nil
}

func (u *QuizServiceImpl) GetQuizByPreferences(
	languagePreference string,
	subjectPreference string,
	testLevel string,
	questionPreference string,
	timePreference string,
) (map[string]interface{}, error) {
	return u.GetQuizByPreferencesWithExclusions(
		languagePreference,
		subjectPreference,
		testLevel,
		questionPreference,
		timePreference,
		nil,
	)
}

func (u *QuizServiceImpl) GetQuizByPreferencesWithExclusions(
	languagePreference string,
	subjectPreference string,
	testLevel string,
	questionPreference string,
	timePreference string,
	excludeIDs []string,
) (map[string]interface{}, error) {

	// --- Parse Question Limit (default: 25) ---
	questionLimit := 25
	if q := strings.TrimSpace(questionPreference); q != "" {
		q = strings.TrimPrefix(strings.ToUpper(q), "Q")
		parsed, err := strconv.Atoi(q)
		if err != nil || parsed <= 0 {
			return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_PARAM",
				"invalid questionPreference: must be a number like '25' or 'Q25'")
		}
		questionLimit = parsed
	}

	// --- Parse Time Limit (default: 5) ---
	totalTimeMinutes := 5
	if t := strings.TrimSpace(timePreference); t != "" {
		t = strings.TrimPrefix(strings.ToUpper(t), "T")
		parsed, err := strconv.Atoi(t)
		if err != nil || parsed <= 0 {
			return nil, utils.NewAppError(http.StatusBadRequest, "INVALID_PARAM",
				"invalid timePreference: must be a number like '5' or 'T45'")
		}
		totalTimeMinutes = parsed
	}

	// --- Build Filter ---
	matchConditions := bson.D{}

	lang := strings.ToLower(strings.TrimSpace(languagePreference))
	subj := strings.ToLower(strings.TrimSpace(subjectPreference))
	level := strings.ToLower(strings.TrimSpace(testLevel))

	if lang != "" {
		matchConditions = append(matchConditions, bson.E{
			Key:   "testQuiz",
			Value: bson.M{"$regex": lang, "$options": "i"},
		})
	}
	if subj != "" {
		matchConditions = append(matchConditions, bson.E{
			Key:   "subject",
			Value: bson.M{"$regex": subj, "$options": "i"},
		})
	}
	if level != "" {
		matchConditions = append(matchConditions, bson.E{
			Key:   "testLevel",
			Value: bson.M{"$regex": level, "$options": "i"},
		})
	}

	filter := bson.D{}
	if len(matchConditions) > 0 {
		filter = matchConditions
	}

	// --- Count matching documents first ---
	count, err := u.quizcollection.CountDocuments(u.ctx, filter)
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "DB_ERROR",
			fmt.Sprintf("database error: %v", err))
	}

	if count == 0 {
		if len(filter) == 0 {
			return nil, utils.NewAppError(http.StatusServiceUnavailable, "QUIZ_CATALOG_EMPTY",
				"no quizzes exist in the database")
		}
		return nil, utils.NewAppError(http.StatusUnprocessableEntity, "NO_QUIZZES",
			fmt.Sprintf("no quizzes found for: language=%s, subject=%s, level=%s",
				lang, subj, level))
	}

	if int64(questionLimit) > count {
		questionLimit = int(count)
	}

	// --- Resolve Exclusions ---
	var validExcludeObjectIDs []bson.ObjectID
	seenValid := make(map[bson.ObjectID]struct{})
	for _, rawID := range excludeIDs {
		trimmed := strings.TrimSpace(rawID)
		if trimmed == "" {
			continue
		}
		if objID, err := bson.ObjectIDFromHex(trimmed); err == nil {
			if _, exists := seenValid[objID]; !exists {
				seenValid[objID] = struct{}{}
				validExcludeObjectIDs = append(validExcludeObjectIDs, objID)
			}
		}
	}

	var quizResponses []QuizResponse

	// If exclusions exist, first attempt to sample from unseen questions
	if len(validExcludeObjectIDs) > 0 {
		unseenConditions := append(bson.D{}, matchConditions...)
		unseenConditions = append(unseenConditions, bson.E{
			Key:   "_id",
			Value: bson.M{"$nin": validExcludeObjectIDs},
		})

		unseenCount, err := u.quizcollection.CountDocuments(u.ctx, unseenConditions)
		if err == nil && unseenCount > 0 {
			targetUnseen := questionLimit
			if int64(targetUnseen) > unseenCount {
				targetUnseen = int(unseenCount)
			}
			sampledUnseen, err := u.sampleQuizzes(unseenConditions, targetUnseen)
			if err == nil && len(sampledUnseen) > 0 {
				quizResponses = append(quizResponses, sampledUnseen...)
			}
		}

		// If unseen questions alone did not fill questionLimit, fill the remainder
		if len(quizResponses) < questionLimit {
			var alreadyChosenIDs []bson.ObjectID
			for _, q := range quizResponses {
				if objID, err := bson.ObjectIDFromHex(q.ID); err == nil {
					alreadyChosenIDs = append(alreadyChosenIDs, objID)
				}
			}

			fallbackConditions := append(bson.D{}, matchConditions...)
			if len(alreadyChosenIDs) > 0 {
				fallbackConditions = append(fallbackConditions, bson.E{
					Key:   "_id",
					Value: bson.M{"$nin": alreadyChosenIDs},
				})
			}
			needed := questionLimit - len(quizResponses)
			fallbackSampled, err := u.sampleQuizzes(fallbackConditions, needed)
			if err == nil && len(fallbackSampled) > 0 {
				quizResponses = append(quizResponses, fallbackSampled...)
			}
		}
	}

	// If no exclusions or sampling above didn't yield questions, sample normally
	if len(quizResponses) == 0 {
		sampled, err := u.sampleQuizzes(matchConditions, questionLimit)
		if err != nil {
			return nil, err
		}
		quizResponses = sampled
	}

	if len(quizResponses) == 0 {
		return nil, utils.NewAppError(http.StatusUnprocessableEntity, "NO_QUIZZES",
			"no quizzes found after sampling")
	}

	// --- Shuffle In-Memory so order is genuinely random ---
	rand.Shuffle(len(quizResponses), func(i, j int) {
		quizResponses[i], quizResponses[j] = quizResponses[j], quizResponses[i]
	})

	totalEarning := 0
	for _, quiz := range quizResponses {
		if earning, err := strconv.Atoi(strings.TrimSpace(quiz.Earning)); err == nil {
			totalEarning += earning
		}
	}

	return map[string]interface{}{
		"totalQuestions": len(quizResponses),
		"totalTime":      totalTimeMinutes,
		"totalEarning":   totalEarning,
		"quizzes":        quizResponses,
	}, nil
}

func (u *QuizServiceImpl) SubmitQuiz(
	request models.SubmitQuizRequest,
) (map[string]interface{}, error) {

	userID := request.UserID

	totalScore := 0
	totalEarning := 0
	subject := ""
	rewardType := "" // capture from first response

	var responses []models.QuizAnswer

	for _, response := range request.Responses {

		quizObjectID, err := bson.ObjectIDFromHex(response.QuizID)
		if err != nil {
			return nil, errors.New("invalid quizId")
		}

		quiz, err := u.GetQuiz(response.QuizID)
		if err != nil {
			return nil, errors.New("quiz not found")
		}

		if subject == "" && quiz.Subject != "" {
			subject = quiz.Subject
		}

		// Capture reward type from the first response
		if rewardType == "" && response.RewardType != "" {
			rewardType = response.RewardType
		}

		correctAnswer := quiz.Answer

		isCorrect := gradeAnswer(response.SelectedAnswer, correctAnswer, quiz.Options)

		earning := 0

		if isCorrect {
			totalScore++
			earningValue, _ := strconv.Atoi(quiz.Earning)
			earning = earningValue
			totalEarning += earningValue
		}

		responses = append(responses, models.QuizAnswer{
			QuizID:         quizObjectID,
			SelectedAnswer: response.SelectedAnswer,
			Subject:        quiz.Subject,
			IsCorrect:      isCorrect,
			CorrectAnswer:  correctAnswer,
			Earning:        earning,
		})
	}

	submission := models.QuizSubmission{
		ID:            bson.NewObjectID(),
		UserID:        userID,
		Subject:       subject,
		Score:         totalScore,
		TotalAnswered: len(request.Responses),
		TotalEarning:  totalEarning,
		RewardType:    request.RewardType,
		QuizTime:      request.QuizTime,
		Responses:     responses,
		SubmittedAt:   time.Now(),
	}

	_, err := u.quizSubmissionCollection.InsertOne(
		u.ctx,
		submission,
	)

	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"submission":     submission,
		"correctAnswers": totalScore,
		"totalQuestions": len(request.Responses),
	}, nil
}

// func (s *QuizServiceImpl) GetUserSubmissions(userID string) ([]models.QuizSubmission, error) {
// 	if userID == "" {
// 		return nil, errors.New("userID is required")
// 	}

// 	filter := bson.M{
// 		"userId": userID,
// 	}

// 	cursor, err := s.quizSubmissionCollection.Find(s.ctx, filter)
// 	if err != nil {
// 		return nil, err
// 	}
// 	defer cursor.Close(s.ctx)

// 	var submissions []models.QuizSubmission

// 	for cursor.Next(s.ctx) {
// 		var sub models.QuizSubmission
// 		if err := cursor.Decode(&sub); err != nil {
// 			return nil, err
// 		}
// 		submissions = append(submissions, sub)
// 	}

// 	if err := cursor.Err(); err != nil {
// 		return nil, err
// 	}

// 	return submissions, nil
// }

// func (s *QuizServiceImpl) GetUserSubmissions(userID string) ([]models.QuizSubmission, error) {
// 	if userID == "" {
// 		return nil, errors.New("userID is required")
// 	}

// 	filter := bson.M{"userId": userID}
// 	opts := options.Find().SetSort(bson.D{{Key: "submittedAt", Value: -1}}) // ✅ newest first

// 	cursor, err := s.quizSubmissionCollection.Find(s.ctx, filter, opts)
// 	if err != nil {
// 		return nil, err
// 	}
// 	defer cursor.Close(s.ctx)

// 	groupedMap := make(map[string]*models.QuizSubmission)
// 	orderMap := []string{}

// 	for cursor.Next(s.ctx) {
// 		var doc models.QuizSubmissionDoc
// 		if err := cursor.Decode(&doc); err != nil {
// 			return nil, err
// 		}

// 		quizKey := doc.QuizID.Hex() // group by quizId

// 		existing, found := groupedMap[quizKey]
// 		if !found {
// 			newSub := &models.QuizSubmission{
// 				ID:          doc.ID,
// 				UserID:      doc.UserID,
// 				Responses:   []models.QuizAnswer{},
// 				SubmittedAt: doc.SubmittedAt,
// 			}
// 			groupedMap[quizKey] = newSub
// 			orderMap = append(orderMap, quizKey)
// 			existing = newSub
// 		}

// 		existing.Responses = append(existing.Responses, models.QuizAnswer{
// 			QuizID:         doc.QuizID,
// 			SelectedAnswer: doc.SelectedAnswer,
// 			IsCorrect:      doc.IsCorrect,
// 			CorrectAnswer:  doc.CorrectAnswer,
// 			Earning:        doc.Earning,
// 		})

// 		existing.TotalAnswered++
// 		if doc.IsCorrect {
// 			existing.Score++
// 			existing.TotalEarning += doc.Earning
// 		}
// 	}

// 	if err := cursor.Err(); err != nil {
// 		return nil, err
// 	}

// 	if len(groupedMap) == 0 {
// 		return nil, errors.New("no submissions found for user")
// 	}

// 	submissions := make([]models.QuizSubmission, 0, len(orderMap))
// 	for _, key := range orderMap {
// 		submissions = append(submissions, *groupedMap[key])
// 	}

// 	return submissions, nil
// }

func (s *QuizServiceImpl) GetUserSubmissions(userID string) ([]models.QuizSubmission, error) {
	if userID == "" {
		return nil, errors.New("userID is required")
	}

	filter := bson.M{"userId": userID}

	opts := options.Find().
		SetSort(bson.D{{Key: "submittedAt", Value: -1}})

	cursor, err := s.quizSubmissionCollection.Find(s.ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(s.ctx)

	var submissions []models.QuizSubmission

	for cursor.Next(s.ctx) {
		var submission models.QuizSubmission

		if err := cursor.Decode(&submission); err != nil {
			return nil, err
		}

		submissions = append(submissions, submission)
	}

	if err := cursor.Err(); err != nil {
		return nil, err
	}

	if len(submissions) == 0 {
		return nil, errors.New("no submissions found for user")
	}

	return submissions, nil
}

// func (s *QuizServiceImpl) GetAllSubmissions() ([]models.QuizSubmission, error) {
// 	cursor, err := s.quizSubmissionCollection.Find(s.ctx, bson.M{})
// 	if err != nil {
// 		return nil, err
// 	}
// 	defer cursor.Close(s.ctx)

// 	var submissions []models.QuizSubmission

// 	for cursor.Next(s.ctx) {
// 		var sub models.QuizSubmission
// 		if err := cursor.Decode(&sub); err != nil {
// 			return nil, err
// 		}
// 		submissions = append(submissions, sub)
// 	}

// 	if err := cursor.Err(); err != nil {
// 		return nil, err
// 	}

// 	return submissions, nil
// }

// func (s *QuizServiceImpl) GetAllSubmissions() ([]models.QuizSubmission, error) {
//     cursor, err := s.quizSubmissionCollection.Find(s.ctx, bson.M{})
//     if err != nil {
//         return nil, err
//     }
//     defer cursor.Close(s.ctx)

//     var submissions []models.QuizSubmission

//     for cursor.Next(s.ctx) {
//         var doc models.QuizSubmissionDoc        // ✅ decode into flat DB struct
//         if err := cursor.Decode(&doc); err != nil {
//             return nil, err
//         }
//         submissions = append(submissions, models.ToSubmissionDTO(doc)) // ✅ convert to API shape
//     }

//     if err := cursor.Err(); err != nil {
//         return nil, err
//     }

//     return submissions, nil
// }

func (s *QuizServiceImpl) GetAllSubmissions() ([]models.QuizSubmission, error) {

	opts := options.Find().
		SetSort(bson.D{{Key: "submittedAt", Value: -1}})

	cursor, err := s.quizSubmissionCollection.Find(s.ctx, bson.M{}, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(s.ctx)

	var submissions []models.QuizSubmission

	for cursor.Next(s.ctx) {
		var submission models.QuizSubmission

		if err := cursor.Decode(&submission); err != nil {
			return nil, err
		}

		submissions = append(submissions, submission)
	}

	if err := cursor.Err(); err != nil {
		return nil, err
	}

	return submissions, nil
}

func (u *QuizServiceImpl) GetQuizAnswerById(id string) (map[string]interface{}, error) {

	objectID, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, errors.New("invalid quiz id")
	}

	filter := bson.M{"_id": objectID}

	var quiz models.Quiz
	err = u.quizcollection.FindOne(u.ctx, filter).Decode(&quiz)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, errors.New("quiz not found")
		}
		return nil, err
	}

	response := map[string]interface{}{
		"id":     quiz.ID.Hex(),
		"answer": quiz.Answer,
	}

	return response, nil
}

func (u *QuizServiceImpl) GetLiveQuizAnswerById(userID int, id string) (map[string]interface{}, error) {
	objectID, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, errors.New("invalid live quiz id")
	}

	quizFilter := bson.M{"_id": objectID}
	var liveQuiz models.LiveQuiz
	if err := u.liveQuizCollection.FindOne(u.ctx, quizFilter).Decode(&liveQuiz); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, errors.New("live quiz not found")
		}
		return nil, err
	}

	response := map[string]interface{}{
		"id":             liveQuiz.ID.Hex(),
		"selectedAnswer": "",
		"answer":         "",
	}

	if userID <= 0 {
		return response, nil
	}

	if utils.DB == nil {
		return nil, errors.New("postgres is not configured")
	}

	var liveQuizSessions []struct {
		Answers JSONB `gorm:"column:answers"`
	}
	if err := utils.DB.Raw(
		`SELECT "answers" FROM "ongoing_live_quiz" WHERE "userId" = ? AND ? = ANY("quizIds") ORDER BY "updatedAt" DESC`,
		strconv.Itoa(userID),
		id,
	).Scan(&liveQuizSessions).Error; err != nil {
		return nil, err
	}

	for _, session := range liveQuizSessions {
		answer, found, err := findLiveQuizSubmission([]byte(session.Answers), id)
		if err != nil {
			return nil, err
		}
		if found {
			response["selectedAnswer"] = answer.SelectedAnswer
			response["answer"] = answer.SelectedAnswer
			return response, nil
		}
	}

	var ongoingQuiz models.OngoingQuiz
	err = utils.DB.
		Where(`"userId" = ?`, userID).
		Where(`"questions" @> ?`, fmt.Sprintf(`[{"id":"%s"}]`, id)).
		Order(`"updatedAt" DESC`).
		First(&ongoingQuiz).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return response, nil
		}
		return nil, err
	}

	storedAnswers := parseStoredSessionAnswers(ongoingQuiz.Answers)
	selectedAnswer := ""
	for _, answer := range storedAnswers {
		if strings.TrimSpace(answer.QuizID) == id {
			selectedAnswer = strings.TrimSpace(answer.SelectedAnswer)
			break
		}
	}

	if selectedAnswer != "" {
		response["selectedAnswer"] = selectedAnswer
		response["answer"] = selectedAnswer
	}

	return response, nil
}

func (u *QuizServiceImpl) DeleteLiveQuiz(id string) error {
	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return errors.New("invalid id format")
	}

	var existing models.LiveQuiz
	if err := u.liveQuizCollection.FindOne(u.ctx, bson.M{"_id": objectId}).Decode(&existing); err != nil {
		if err == mongo.ErrNoDocuments {
			return errors.New("live quiz not found")
		}
		return err
	}
	now, _ := lagosNow()
	if (now.Equal(existing.QuizScheduleDate) || now.After(existing.QuizScheduleDate)) && now.Before(existing.QuizFinishDate) {
		return fmt.Errorf("%w: active quizzes cannot be deleted", ErrLiveQuizActive)
	}

	filter := bson.M{"_id": objectId}

	result, err := u.liveQuizCollection.DeleteOne(u.ctx, filter)
	if err != nil {
		return err
	}

	if result.DeletedCount == 0 {
		return errors.New("live quiz not found")
	}

	return nil
}

func (u *QuizServiceImpl) UpdateLiveQuizCustomCountdownLabel(id string, phase string, label string) error {
	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return errors.New("invalid id format")
	}

	phaseKey := "customCountdownLabelDuring"
	switch strings.ToLower(strings.TrimSpace(phase)) {
	case "before":
		phaseKey = "customCountdownLabelBefore"
	case "after":
		phaseKey = "customCountdownLabelAfter"
	default:
		phaseKey = "customCountdownLabelDuring"
	}

	result, err := u.liveQuizCollection.UpdateOne(
		u.ctx,
		bson.M{"_id": objectId},
		bson.M{
			"$set": bson.M{
				phaseKey: strings.TrimSpace(label),
			},
		},
	)
	if err != nil {
		return err
	}
	if result.MatchedCount == 0 {
		return errors.New("live quiz not found")
	}
	return nil
}

func (u *QuizServiceImpl) DeleteLiveQuizCustomCountdownLabel(id string, phase string) error {
	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return errors.New("invalid id format")
	}

	phaseKey := "customCountdownLabelDuring"
	switch strings.ToLower(strings.TrimSpace(phase)) {
	case "before":
		phaseKey = "customCountdownLabelBefore"
	case "after":
		phaseKey = "customCountdownLabelAfter"
	default:
		phaseKey = "customCountdownLabelDuring"
	}

	result, err := u.liveQuizCollection.UpdateOne(
		u.ctx,
		bson.M{"_id": objectId},
		bson.M{
			"$unset": bson.M{
				phaseKey: "",
			},
		},
	)
	if err != nil {
		return err
	}
	if result.MatchedCount == 0 {
		return errors.New("live quiz not found")
	}
	return nil
}

func validateCustomCountdownLabel(phase string, text string) (string, string, error) {
	safePhase := strings.ToLower(strings.TrimSpace(phase))
	if safePhase != "before" && safePhase != "during" && safePhase != "after" {
		return "", "", errors.New("phase must be before, during, or after")
	}
	safeText := strings.TrimSpace(text)
	if safeText == "" {
		return "", "", errors.New("custom countdown label text is required")
	}
	return safePhase, safeText, nil
}

func (u *QuizServiceImpl) CreateLiveQuizCustomCountdownLabel(id string, phase string, text string) (*models.LiveQuiz, error) {
	safePhase, safeText, err := validateCustomCountdownLabel(phase, text)
	if err != nil {
		return nil, err
	}
	objectID, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, errors.New("invalid live quiz id")
	}

	var quiz models.LiveQuiz
	if err := u.liveQuizCollection.FindOne(u.ctx, bson.M{"_id": objectID}).Decode(&quiz); err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, errors.New("live quiz not found")
		}
		return nil, err
	}

	quiz.CustomCountdownLabels = append(quiz.CustomCountdownLabels, models.CustomCountdownLabel{
		ID: bson.NewObjectID().Hex(), Phase: safePhase, Text: safeText,
	})
	if _, err := u.liveQuizCollection.UpdateOne(u.ctx, bson.M{"_id": objectID}, bson.M{"$set": bson.M{"customCountdownLabels": quiz.CustomCountdownLabels}}); err != nil {
		return nil, err
	}
	return u.GetLiveQuiz(id)
}

func (u *QuizServiceImpl) UpdateLiveQuizCustomCountdownLabelByID(id string, labelID string, phase string, text string) (*models.LiveQuiz, error) {
	safePhase, safeText, err := validateCustomCountdownLabel(phase, text)
	if err != nil {
		return nil, err
	}
	objectID, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, errors.New("invalid live quiz id")
	}

	var quiz models.LiveQuiz
	if err := u.liveQuizCollection.FindOne(u.ctx, bson.M{"_id": objectID}).Decode(&quiz); err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, errors.New("live quiz not found")
		}
		return nil, err
	}
	found := false
	for index := range quiz.CustomCountdownLabels {
		if quiz.CustomCountdownLabels[index].ID == labelID {
			quiz.CustomCountdownLabels[index].Phase = safePhase
			quiz.CustomCountdownLabels[index].Text = safeText
			found = true
			break
		}
	}
	if !found {
		return nil, errors.New("custom countdown label not found")
	}
	if _, err := u.liveQuizCollection.UpdateOne(u.ctx, bson.M{"_id": objectID}, bson.M{"$set": bson.M{"customCountdownLabels": quiz.CustomCountdownLabels}}); err != nil {
		return nil, err
	}
	return u.GetLiveQuiz(id)
}

func (u *QuizServiceImpl) DeleteLiveQuizCustomCountdownLabelByID(id string, labelID string) (*models.LiveQuiz, error) {
	objectID, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, errors.New("invalid live quiz id")
	}

	var quiz models.LiveQuiz
	if err := u.liveQuizCollection.FindOne(u.ctx, bson.M{"_id": objectID}).Decode(&quiz); err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, errors.New("live quiz not found")
		}
		return nil, err
	}
	labels := make([]models.CustomCountdownLabel, 0, len(quiz.CustomCountdownLabels))
	found := false
	for _, label := range quiz.CustomCountdownLabels {
		if label.ID == labelID {
			found = true
			continue
		}
		labels = append(labels, label)
	}
	if !found {
		return nil, errors.New("custom countdown label not found")
	}
	if _, err := u.liveQuizCollection.UpdateOne(u.ctx, bson.M{"_id": objectID}, bson.M{"$set": bson.M{"customCountdownLabels": labels}}); err != nil {
		return nil, err
	}
	return u.GetLiveQuiz(id)
}

func (u *QuizServiceImpl) UpdateLiveQuiz(quiz *models.LiveQuiz) error {
	var existing models.LiveQuiz
	if err := u.liveQuizCollection.FindOne(u.ctx, bson.M{"_id": quiz.ID}).Decode(&existing); err != nil {
		if err == mongo.ErrNoDocuments {
			return errors.New("live quiz not found")
		}
		return err
	}

	now, _ := lagosNow()
	if (now.Equal(existing.QuizScheduleDate) || now.After(existing.QuizScheduleDate)) && now.Before(existing.QuizFinishDate) {
		return fmt.Errorf("%w: active quizzes cannot be edited", ErrLiveQuizActive)
	}

	if quiz.QuizFinishDate.IsZero() {
		quiz.QuizFinishDate = existing.QuizFinishDate
	}
	if quiz.QuizScheduleDate.IsZero() {
		quiz.QuizScheduleDate = existing.QuizScheduleDate
	}
	if !quiz.QuizFinishDate.After(quiz.QuizScheduleDate) {
		return errors.New("quiz finish date must be after quiz schedule date")
	}
	if quiz.JackpotAmount <= 0 {
		quiz.JackpotAmount = quiz.TotalPrize
	}
	if quiz.TotalPrize <= 0 && quiz.JackpotAmount > 0 {
		quiz.TotalPrize = quiz.JackpotAmount
	}
	if quiz.CustomCountdownLabels == nil {
		quiz.CustomCountdownLabels = existing.CustomCountdownLabels
	}

	filter := bson.D{
		{Key: "_id", Value: quiz.ID},
	}

	update := bson.D{
		{
			Key: "$set",
			Value: bson.D{
				{Key: "question", Value: quiz.Question},
				{Key: "options", Value: quiz.Options},
				{Key: "answer", Value: quiz.Answer},
				{Key: "isTypedAnswer", Value: quiz.IsTypedAnswer},
				{Key: "typedAnswer", Value: quiz.TypedAnswer},
				{Key: "jackpotAmount", Value: quiz.JackpotAmount},
				{Key: "totalPrize", Value: quiz.TotalPrize},
				{Key: "recipients", Value: quiz.Recipients},
				{Key: "unitPrize", Value: quiz.UnitPrize},
				{Key: "showAnswer", Value: quiz.ShowAnswer},
				{Key: "quizScheduleDate", Value: quiz.QuizScheduleDate},
				{Key: "quizFinishDate", Value: quiz.QuizFinishDate},
				{Key: "imageLink", Value: quiz.ImageLink},
				{Key: "customCountdownLabel", Value: strings.TrimSpace(quiz.CustomCountdownLabel)},
				{Key: "customCountdownLabelBefore", Value: strings.TrimSpace(quiz.CustomCountdownLabelBefore)},
				{Key: "customCountdownLabelDuring", Value: strings.TrimSpace(quiz.CustomCountdownLabelDuring)},
				{Key: "customCountdownLabelAfter", Value: strings.TrimSpace(quiz.CustomCountdownLabelAfter)},
				{Key: "customCountdownLabels", Value: quiz.CustomCountdownLabels},
			},
		},
	}

	result, err := u.liveQuizCollection.UpdateOne(u.ctx, filter, update)
	if err != nil {
		return err
	}

	if result.MatchedCount == 0 {
		return errors.New("live quiz not found")
	}

	return nil
}

func (u *QuizServiceImpl) CreateQuizCategory(category *models.QuizCategory) (*models.QuizCategory, error) {

	// Basic validation (optional but recommended)
	if category.TestQuiz == "" {
		return nil, errors.New("testQuiz is required")
	}

	if category.Subject == "" {
		return nil, errors.New("subject is required")
	}

	// Generate ID
	if category.ID.IsZero() {
		category.ID = bson.NewObjectID()
	}

	// Normalize values (optional but useful for consistency)
	category.TestQuiz = strings.ToLower(category.TestQuiz)
	category.Subject = strings.ToLower(category.Subject)

	// Insert category into MongoDB
	_, err := u.quizCategoryCollection.InsertOne(u.ctx, category)
	if err != nil {
		return nil, err
	}

	return category, nil
}

func (u *QuizServiceImpl) GetAllCategory() ([]*models.QuizCategory, error) {
	var categories []*models.QuizCategory

	cursor, err := u.quizCategoryCollection.Find(u.ctx, bson.D{})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(u.ctx)

	for cursor.Next(u.ctx) {
		var category models.QuizCategory

		if err := cursor.Decode(&category); err != nil {
			return nil, err
		}

		// ✅ Convert ObjectID to string for JSON response
		// category.IDHex = category.ID.Hex()

		categories = append(categories, &category)
	}

	if err := cursor.Err(); err != nil {
		return nil, err
	}

	if len(categories) == 0 {
		return nil, errors.New("no quiz categories found")
	}

	return categories, nil
}

func (u *QuizServiceImpl) GetCategoryById(id string) (*models.QuizCategory, error) {
	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, errors.New("invalid id format")
	}

	var category models.QuizCategory

	filter := bson.M{"_id": objectId}

	err = u.quizCategoryCollection.FindOne(u.ctx, filter).Decode(&category)
	if err != nil {
		return nil, err
	}

	return &category, nil
}

func (u *QuizServiceImpl) GetQuiz(id string) (*models.Quiz, error) {
	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, errors.New("invalid id format")
	}

	var quiz models.Quiz

	filter := bson.M{"_id": objectId}

	err = u.quizcollection.FindOne(u.ctx, filter).Decode(&quiz)
	if err != nil {
		return nil, err
	}

	return &quiz, nil
}

func (u *QuizServiceImpl) SearchQuizzes(query string, limit int) ([]map[string]interface{}, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}

	query = strings.TrimSpace(query)
	if query == "" {
		return []map[string]interface{}{}, nil
	}

	filter := bson.M{
		"question": bson.M{"$regex": query, "$options": "i"},
	}

	findOptions := options.Find().
		SetSort(bson.D{{Key: "question", Value: 1}}).
		SetLimit(int64(limit))

	cursor, err := u.quizcollection.Find(context.Background(), filter, findOptions)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.Background())

	var quizzes []models.Quiz
	if err := cursor.All(context.Background(), &quizzes); err != nil {
		return nil, err
	}

	results := make([]map[string]interface{}, 0, len(quizzes))
	for _, q := range quizzes {
		results = append(results, map[string]interface{}{
			"id":        q.ID.Hex(),
			"question":  q.Question,
			"testQuiz":  q.TestQuiz,
			"testLevel": q.TestLevel,
			"subject":   q.Subject,
			"answer":    q.Answer,
			"options":   q.Options,
			"earning":   q.Earning,
			"imageLink": q.ImageLink,
		})
	}

	return results, nil
}

func (u *QuizServiceImpl) GetAllQuiz() ([]*models.Quiz, error) {
	var quizzes []*models.Quiz

	cursor, err := u.quizcollection.Find(u.ctx, bson.D{})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(u.ctx)

	for cursor.Next(u.ctx) {
		var quiz models.Quiz

		if err := cursor.Decode(&quiz); err != nil {
			return nil, err
		}

		// ✅ Convert ObjectID to string for JSON response
		quiz.IDHex = quiz.ID.Hex()

		quizzes = append(quizzes, &quiz)
	}

	if err := cursor.Err(); err != nil {
		return nil, err
	}

	if len(quizzes) == 0 {
		return nil, errors.New("no quizzes found")
	}

	return quizzes, nil
}

func (u *QuizServiceImpl) UpdateQuiz(quiz *models.Quiz) error {
	if err := validateQuizMediaUrls(quiz.ImageLink); err != nil {
		return err
	}

	filter := bson.D{bson.E{Key: "_id", Value: quiz.ID}}
	setFields := bson.D{
		{Key: "question", Value: quiz.Question},
		{Key: "options", Value: quiz.Options},
		{Key: "imageLink", Value: quiz.ImageLink},
		{Key: "isTypedAnswer", Value: quiz.IsTypedAnswer},
		{Key: "typedAnswer", Value: quiz.TypedAnswer},
		{Key: "earning", Value: quiz.Earning},
		{Key: "answer", Value: quiz.Answer},
	}
	if strings.TrimSpace(quiz.TestQuiz) != "" {
		setFields = append(setFields, bson.E{Key: "testQuiz", Value: quiz.TestQuiz})
	}
	if strings.TrimSpace(quiz.TestLevel) != "" {
		setFields = append(setFields, bson.E{Key: "testLevel", Value: quiz.TestLevel})
	}
	if strings.TrimSpace(quiz.Subject) != "" {
		setFields = append(setFields, bson.E{Key: "subject", Value: quiz.Subject})
	}
	if strings.TrimSpace(quiz.AirtableRecordID) != "" {
		setFields = append(setFields, bson.E{Key: "airtableRecordId", Value: quiz.AirtableRecordID})
	}

	update := bson.D{bson.E{Key: "$set", Value: setFields}}

	result, err := u.quizcollection.UpdateOne(u.ctx, filter, update)
	if err != nil {
		return err
	}

	if result.MatchedCount == 0 {
		return errors.New("no quiz found with given id")
	}

	return nil
}

func (u *QuizServiceImpl) DeleteQuiz(id string) error {
	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return errors.New("invalid id format")
	}

	filter := bson.M{"_id": objectId}

	result, err := u.quizcollection.DeleteOne(u.ctx, filter)
	if err != nil {
		return err
	}

	if result.DeletedCount == 0 {
		return errors.New("no quiz found with given id")
	}

	return nil
}

func (u *QuizServiceImpl) UpdateQuizAudioURL(id string, lang string, audioURL string) error {
	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return errors.New("invalid id format")
	}

	normalizedLang := strings.ToLower(strings.TrimSpace(lang))
	if normalizedLang == "" {
		normalizedLang = "yo"
	}

	filter := bson.M{"_id": objectId}
	update := bson.M{
		"$set": bson.M{
			"audioUrl": audioURL,
			fmt.Sprintf("audioUrls.%s", normalizedLang): audioURL,
		},
	}

	_, err = u.quizcollection.UpdateOne(u.ctx, filter, update)
	return err
}

func (u *QuizServiceImpl) UpdateLiveQuizAudioURL(id string, lang string, audioURL string) error {
	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return errors.New("invalid id format")
	}

	normalizedLang := strings.ToLower(strings.TrimSpace(lang))
	if normalizedLang == "" {
		normalizedLang = "yo"
	}

	filter := bson.M{"_id": objectId}
	update := bson.M{
		"$set": bson.M{
			"audioUrl": audioURL,
			fmt.Sprintf("audioUrls.%s", normalizedLang): audioURL,
		},
	}

	_, err = u.liveQuizCollection.UpdateOne(u.ctx, filter, update)
	return err
}
