package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
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
	switch strings.ToLower(strings.TrimSpace(phase)) {
	case "before":
		if trimmedOverride := strings.TrimSpace(overrideBefore); trimmedOverride != "" {
			return trimmedOverride
		}
	case "during":
		if trimmedOverride := strings.TrimSpace(overrideDuring); trimmedOverride != "" {
			return trimmedOverride
		}
	case "after":
		if trimmedOverride := strings.TrimSpace(overrideAfter); trimmedOverride != "" {
			return trimmedOverride
		}
	}

	return defaultLabel
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
			"Waiting for Live Quiz to start; starts in %s.",
			formatLiveQuizCountdown(startAt, now),
		)
		phase = "before"
	case "live":
		defaultLabel = "Select an answer by clicking on the 3 dots in front of the live quiz."
		phase = "during"
	default:
		defaultLabel = fmt.Sprintf(
			"Quiz window closed %s",
			formatLiveQuizElapsed(finishAt, now),
		)
		phase = "after"
	}

	return resolveQuizCountdownLabel(defaultLabel, phase, overrideBefore, overrideDuring, overrideAfter)
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
	}
}

// func NewQuizSubmissionService(collection *mongo.Collection, ctx context.Context) QuizSubmissionService {
// 	return &QuizServiceImpl{
// 		quizSubmissionCollection: collection,
// 		ctx:                      ctx,
// 	}
// }

func (u *QuizServiceImpl) CreateQuiz(quiz *models.Quiz) error {

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
	quiz.TestQuiz = strings.ToLower(quiz.TestQuiz)
	quiz.TestLevel = strings.ToLower(quiz.TestLevel)
	quiz.Subject = strings.ToLower(quiz.Subject)

	// Assign earning based on testLevel (string-based)
	switch quiz.TestLevel {
	case "basic":
		quiz.Earning = "400"
	case "intermediate":
		quiz.Earning = "600"
	case "advanced":
		quiz.Earning = "800"
	default:
		return errors.New("invalid testLevel value")
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

// func (u *QuizServiceImpl) GetQuizByPreferences(
// 	languagePreference string,
// 	subjectPreference string,
// 	testLevel string,
// 	questionPreference string,
// 	timePreference string,
// ) (map[string]interface{}, error) {

// 	// Validate empty fields
// 	if languagePreference == "" ||
// 		subjectPreference == "" ||
// 		testLevel == "" ||
// 		questionPreference == "" ||
// 		timePreference == "" {
// 		return nil, errors.New("missing required query parameters")
// 	}

// 	// Normalize values (optional but recommended)
// 	languagePreference = strings.ToLower(languagePreference)
// 	subjectPreference = strings.ToLower(subjectPreference)
// 	testLevel = strings.ToLower(testLevel)

// 	// Parse Question Preference
// 	questionPreference = strings.TrimSpace(strings.ToUpper(questionPreference))
// 	if strings.HasPrefix(questionPreference, "Q") {
// 		questionPreference = strings.TrimPrefix(questionPreference, "Q")
// 	}
// 	questionLimit, err := strconv.Atoi(strings.TrimSpace(questionPreference))
// 	if err != nil || questionLimit <= 0 {
// 		return nil, errors.New("invalid questionPreference")
// 	}

// 	// Parse Time Preference
// 	timeLimitStr := strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(timePreference)), "T")
// 	totalTimeMinutes, err := strconv.Atoi(strings.TrimSpace(timeLimitStr))
// 	if err != nil || totalTimeMinutes <= 0 {
// 		return nil, errors.New("invalid timePreference")
// 	}

// 	filter := bson.M{
// 		"testQuiz":  languagePreference,
// 		"subject":   subjectPreference,
// 		"testLevel": testLevel,
// 	}

// 	count, err := u.quizcollection.CountDocuments(u.ctx, filter)
// 	if err != nil {
// 		return nil, err
// 	}

// 	if count == 0 {
// 		return nil, errors.New("no quizzes found for selected preferences")
// 	}

// 	if count < int64(questionLimit) {
// 		return nil, fmt.Errorf("requested %d questions but only %d quizzes are available", questionLimit, count)
// 	}

// 	// Mongo Pipeline
// 	pipeline := mongo.Pipeline{
// 		{
// 			{
// 				Key: "$match",
// 				Value: bson.M{
// 					"testQuiz":  languagePreference,
// 					"subject":   subjectPreference,
// 					"testLevel": testLevel,
// 				},
// 			},
// 		},
// 		{
// 			{
// 				Key: "$sample",
// 				Value: bson.M{
// 					"size": questionLimit,
// 				},
// 			},
// 		},
// 	}

// 	cursor, err := u.quizcollection.Aggregate(u.ctx, pipeline)
// 	if err != nil {
// 		return nil, err
// 	}
// 	defer cursor.Close(u.ctx)

// 	type QuizResponse struct {
// 		ID        string      `json:"id"`
// 		TestQuiz  string      `json:"testQuiz"`
// 		Earning   string      `json:"earning"`
// 		Subject   string      `json:"subject"`
// 		TestLevel string      `json:"testLevel"`
// 		Question  string      `json:"question"`
// 		ImageLink []string      `json:"imageLink"`
// 		Options   interface{} `json:"options"`
// 	}

// 	var quizResponses []QuizResponse
// 	totalEarning := 0

// 	for cursor.Next(u.ctx) {
// 		var quiz models.Quiz

// 		if err := cursor.Decode(&quiz); err != nil {
// 			return nil, err
// 		}

// 		earning, err := strconv.Atoi(strings.TrimSpace(quiz.Earning))
// 		if err == nil {
// 			totalEarning += earning
// 		}

// 		quizResponses = append(quizResponses, QuizResponse{
// 			ID:        quiz.ID.Hex(),
// 			TestQuiz:  quiz.TestQuiz,
// 			Earning:   quiz.Earning,
// 			Subject:   quiz.Subject,
// 			TestLevel: quiz.TestLevel,
// 			Question:  quiz.Question,
// 			ImageLink: quiz.ImageLink,
// 			Options:   quiz.Options,
// 		})
// 	}

// 	if err := cursor.Err(); err != nil {
// 		return nil, err
// 	}

// 	if len(quizResponses) == 0 {
// 		return nil, errors.New("no quizzes found")
// 	}

// 	if len(quizResponses) != questionLimit {
// 		return nil, fmt.Errorf("requested %d questions but only %d quizzes are available", questionLimit, len(quizResponses))
// 	}

// 	return map[string]interface{}{
// 		"totalQuestions": len(quizResponses),
// 		"totalTime":      totalTimeMinutes,
// 		"totalEarning":   totalEarning,
// 		"quizzes":        quizResponses,
// 	}, nil
// }

// func (u *QuizServiceImpl) GetQuizByPreferences(
// 	languagePreference string,
// 	subjectPreference string,
// 	testLevel string,
// 	questionPreference string,
// 	timePreference string,
// ) (map[string]interface{}, error) {

// 	// Default question preference
// 	if strings.TrimSpace(questionPreference) == "" {
// 		questionPreference = "25"
// 	}

// 	// Default time preference
// 	if strings.TrimSpace(timePreference) == "" {
// 		timePreference = "5"
// 	}

// 	// Normalize values ONCE
// 	languagePreference = strings.ToLower(strings.TrimSpace(languagePreference))
// 	subjectPreference = strings.ToLower(strings.TrimSpace(subjectPreference))
// 	testLevel = strings.ToLower(strings.TrimSpace(testLevel))

// 	// Parse Question Preference — strip leading "Q" or "q"
// 	qPref := strings.TrimSpace(questionPreference)
// 	qPref = strings.TrimPrefix(strings.ToUpper(qPref), "Q")

// 	questionLimit, err := strconv.Atoi(qPref)
// 	if err != nil || questionLimit <= 0 {
// 		return nil, errors.New("invalid questionPreference: must be a positive integer, e.g. '25' or 'Q25'")
// 	}

// 	// Parse Time Preference — strip leading "T" or "t"
// 	tPref := strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(timePreference)), "T")

// 	totalTimeMinutes, err := strconv.Atoi(strings.TrimSpace(tPref))
// 	if err != nil || totalTimeMinutes <= 0 {
// 		return nil, errors.New("invalid timePreference: must be a positive integer, e.g. '5' or 'T45'")
// 	}

// 	// Build filter — only add conditions for non-empty preferences
// 	filter := bson.M{}

// 	if languagePreference != "" {
// 		filter["testQuiz"] = bson.M{"$regex": languagePreference, "$options": "i"}
// 	}
// 	if subjectPreference != "" {
// 		filter["subject"] = bson.M{"$regex": subjectPreference, "$options": "i"}
// 	}
// 	if testLevel != "" {
// 		filter["testLevel"] = bson.M{"$regex": testLevel, "$options": "i"}
// 	}

// 	// Count matching documents
// 	count, err := u.quizcollection.CountDocuments(u.ctx, filter)
// 	if err != nil {
// 		return nil, fmt.Errorf("database error while counting quizzes: %w", err)
// 	}

// 	if count == 0 {
// 		return nil, errors.New("no quizzes found for the selected preferences")
// 	}

// 	// If fewer docs exist than requested, use what's available instead of erroring
// 	if count < int64(questionLimit) {
// 		questionLimit = int(count)
// 	}

// 	// Aggregation: match + random sample
// 	pipeline := mongo.Pipeline{
// 		{{Key: "$match", Value: filter}},
// 		{{Key: "$sample", Value: bson.M{"size": questionLimit}}},
// 	}

// 	cursor, err := u.quizcollection.Aggregate(u.ctx, pipeline)
// 	if err != nil {
// 		return nil, fmt.Errorf("database error during aggregation: %w", err)
// 	}
// 	defer cursor.Close(u.ctx)

// 	type QuizResponse struct {
// 		ID        string      `json:"id"`
// 		TestQuiz  string      `json:"testQuiz"`
// 		Earning   string      `json:"earning"`
// 		Subject   string      `json:"subject"`
// 		TestLevel string      `json:"testLevel"`
// 		Question  string      `json:"question"`
// 		ImageLink []string    `json:"imageLink"`
// 		Options   interface{} `json:"options"`
// 	}

// 	var quizResponses []QuizResponse
// 	totalEarning := 0

// 	for cursor.Next(u.ctx) {
// 		var quiz models.Quiz
// 		if err := cursor.Decode(&quiz); err != nil {
// 			return nil, fmt.Errorf("error decoding quiz document: %w", err)
// 		}

// 		if earning, err := strconv.Atoi(strings.TrimSpace(quiz.Earning)); err == nil {
// 			totalEarning += earning
// 		}

// 		quizResponses = append(quizResponses, QuizResponse{
// 			ID:        quiz.ID.Hex(),
// 			TestQuiz:  quiz.TestQuiz,
// 			Earning:   quiz.Earning,
// 			Subject:   quiz.Subject,
// 			TestLevel: quiz.TestLevel,
// 			Question:  quiz.Question,
// 			ImageLink: quiz.ImageLink,
// 			Options:   quiz.Options,
// 		})
// 	}

// 	if err := cursor.Err(); err != nil {
// 		return nil, fmt.Errorf("cursor error: %w", err)
// 	}

// 	if len(quizResponses) == 0 {
// 		return nil, errors.New("no quizzes found")
// 	}

// 	return map[string]interface{}{
// 		"totalQuestions": len(quizResponses),
// 		"totalTime":      totalTimeMinutes,
// 		"totalEarning":   totalEarning,
// 		"quizzes":        quizResponses,
// 	}, nil
// }

func (u *QuizServiceImpl) GetQuizByPreferences(
	languagePreference string,
	subjectPreference string,
	testLevel string,
	questionPreference string,
	timePreference string,
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
	// Store individual conditions separately so $match is airtight
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

	// Build the filter for CountDocuments
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

	// Cap to available count
	if int64(questionLimit) > count {
		questionLimit = int(count)
	}

	// --- Pipeline: $match THEN $sample ---
	// Using bson.D (ordered) guarantees $match always runs before $sample
	var pipeline mongo.Pipeline

	if len(matchConditions) > 0 {
		pipeline = mongo.Pipeline{
			// Stage 1: filter strictly
			bson.D{{Key: "$match", Value: matchConditions}},
			// Stage 2: random sample from filtered set only
			bson.D{{Key: "$sample", Value: bson.D{{Key: "size", Value: questionLimit}}}},
		}
	} else {
		// No filters = full random quiz
		pipeline = mongo.Pipeline{
			bson.D{{Key: "$sample", Value: bson.D{{Key: "size", Value: questionLimit}}}},
		}
	}

	cursor, err := u.quizcollection.Aggregate(u.ctx, pipeline)
	if err != nil {
		return nil, utils.NewAppError(http.StatusInternalServerError, "DB_ERROR",
			fmt.Sprintf("aggregation error: %v", err))
	}
	defer cursor.Close(u.ctx)

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

	var quizResponses []QuizResponse
	totalEarning := 0

	for cursor.Next(u.ctx) {
		var quiz models.Quiz
		if err := cursor.Decode(&quiz); err != nil {
			return nil, utils.NewAppError(http.StatusInternalServerError, "DECODE_ERROR",
				fmt.Sprintf("failed to decode quiz: %v", err))
		}
		if earning, err := strconv.Atoi(strings.TrimSpace(quiz.Earning)); err == nil {
			totalEarning += earning
		}
		quizResponses = append(quizResponses, QuizResponse{
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

	if len(quizResponses) == 0 {
		return nil, utils.NewAppError(http.StatusUnprocessableEntity, "NO_QUIZZES",
			"no quizzes found after sampling")
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
		"submission": submission,
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

	var ongoingQuiz models.OngoingQuiz
	err = utils.DB.
		Where(`"userId" = ? AND "isCompleted" = ?`, userID, false).
		Where(`"questions" @> ?`, fmt.Sprintf(`[{"id":"%s"}]`, id)).
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

func (u *QuizServiceImpl) UpdateLiveQuizCustomCountdownLabel(id string, label string) error {
	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return errors.New("invalid id format")
	}

	result, err := u.liveQuizCollection.UpdateOne(
		u.ctx,
		bson.M{"_id": objectId},
		bson.M{
			"$set": bson.M{
				"customCountdownLabel": strings.TrimSpace(label),
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

func (u *QuizServiceImpl) DeleteLiveQuizCustomCountdownLabel(id string) error {
	objectId, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return errors.New("invalid id format")
	}

	result, err := u.liveQuizCollection.UpdateOne(
		u.ctx,
		bson.M{"_id": objectId},
		bson.M{
			"$unset": bson.M{
				"customCountdownLabel": "",
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
