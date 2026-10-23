package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"quiz.superfan.com/apis/models"
)

type AirtableRecord struct {
	ID     string                 `json:"id"`
	Fields map[string]interface{} `json:"fields"`
}

type AirtableResponse struct {
	Records []AirtableRecord `json:"records"`
	Offset  string           `json:"offset,omitempty"`
	Error   interface{}      `json:"error,omitempty"`
}

type AirtableCreateRequest struct {
	Records []AirtableCreateRecord `json:"records"`
}

type AirtableCreateRecord struct {
	Fields map[string]interface{} `json:"fields"`
}

func SyncFromAirtable(qs QuizService) {
	log.Println("--- Starting Airtable to MongoDB Sync in Go ---")

	rawBaseId := strings.TrimSpace(os.Getenv("AIRTABLE_BASE_ID"))
	apiKey := strings.TrimSpace(os.Getenv("AIRTABLE_API_KEY"))
	tableName := strings.TrimSpace(os.Getenv("AIRTABLE_TABLE_NAME"))

	if tableName == "" {
		tableName = "tbltD2dVLp7hNb60s"
	}

	if rawBaseId == "" || apiKey == "" {
		log.Println("AIRTABLE_BASE_ID or AIRTABLE_API_KEY missing, skipping sync.")
		return
	}

	// Clean base ID and table ID (strip slashes from full URLs)
	baseId := strings.Split(rawBaseId, "/")[0]
	tableName = strings.Split(tableName, "/")[0]

	airtableUrl := fmt.Sprintf("https://api.airtable.com/v0/%s/%s", baseId, url.PathEscape(tableName))
	log.Printf("Fetching from Airtable base: %s, table: %s", baseId, tableName)

	imageFieldEnv := strings.TrimSpace(os.Getenv("AIRTABLE_IMAGE_FIELD"))
	imageFieldCandidates := []string{
		"Image Link",
		"Image",
		"Images",
		"imageLink",
		"image",
	}
	if imageFieldEnv != "" {
		imageFieldCandidates = append([]string{imageFieldEnv}, imageFieldCandidates...)
	}

	// Load existing quizzes so we can create-or-update on every sync.
	// Empty Mongo is normal on first boot — treat "no quizzes found" as [] so sync can seed.
	log.Println("[Debug] Fetching existing quizzes from MongoDB...")
	existingQuizzes, err := qs.GetAllQuiz()
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no quizzes found") {
			log.Println("[Debug] MongoDB quiz collection is empty; seeding from Airtable.")
			existingQuizzes = nil
		} else {
			log.Println("Failed to fetch existing quizzes from DB:", err)
			return
		}
	}
	log.Printf("[Debug] Fetched %d existing quizzes from MongoDB.", len(existingQuizzes))

	existingByQuestion := make(map[string]*models.Quiz)
	existingByAirtableID := make(map[string]*models.Quiz)
	for _, q := range existingQuizzes {
		cleanQ := strings.TrimSpace(strings.ToLower(q.Question))
		if cleanQ != "" {
			existingByQuestion[cleanQ] = q
		}
		airtableID := strings.TrimSpace(q.AirtableRecordID)
		if airtableID != "" {
			existingByAirtableID[airtableID] = q
		}
	}

	inserted := 0
	updated := 0
	offset := ""
	totalFetched := 0
	client := &http.Client{Timeout: 30 * time.Second} // ADDED TIMEOUT

	for {
		fetchUrl := airtableUrl
		if offset != "" {
			fetchUrl = fmt.Sprintf("%s?offset=%s", airtableUrl, url.QueryEscape(offset))
		}

		log.Println("[Debug] Making HTTP request to Airtable...")
		req, err := http.NewRequest("GET", fetchUrl, nil)
		if err != nil {
			log.Println("Error creating Airtable request:", err)
			return
		}

		req.Header.Add("Authorization", "Bearer "+apiKey)
		req.Header.Add("Content-Type", "application/json")

		res, err := client.Do(req)
		if err != nil {
			log.Println("Error making Airtable request:", err)
			return
		}
		log.Printf("[Debug] Airtable responded with status %d", res.StatusCode)

		if res.StatusCode != http.StatusOK {
			log.Printf("Airtable request failed with status: %d", res.StatusCode)
			var errRes map[string]interface{}
			json.NewDecoder(res.Body).Decode(&errRes)
			log.Printf("Airtable error details: %+v", errRes)
			res.Body.Close()
			return
		}

		var parsedRes AirtableResponse
		if err := json.NewDecoder(res.Body).Decode(&parsedRes); err != nil {
			log.Println("Error decoding Airtable response:", err)
			res.Body.Close()
			return
		}
		res.Body.Close()

		totalFetched += len(parsedRes.Records)

		for _, record := range parsedRes.Records {
			fields := record.Fields
			questionText := strings.TrimSpace(firstStringField(fields, "Question Text", "question", "Question"))
			if questionText == "" {
				log.Printf("[Airtable Sync] skip record=%s reason=empty_question", record.ID)
				continue
			}

			cleanQText := strings.TrimSpace(strings.ToLower(questionText))
			optionA := strings.TrimSpace(firstStringField(fields, "Option A", "optionA"))
			optionB := strings.TrimSpace(firstStringField(fields, "Option B", "optionB"))
			optionC := strings.TrimSpace(firstStringField(fields, "Option C", "optionC"))
			optionD := strings.TrimSpace(firstStringField(fields, "Option D", "optionD"))
			correctAnswer := strings.TrimSpace(firstStringField(fields, "Correct Answer", "correctAnswer", "Answer"))
			subject := strings.TrimSpace(firstStringField(fields, "Subject", "subject"))
			levelRaw := strings.ToLower(strings.TrimSpace(firstStringField(fields, "Difficulty Level", "difficulty", "Difficulty")))
			testQuiz := strings.TrimSpace(firstStringField(fields, "Educational Product/Purpose", "educationalProduct", "testQuiz"))
			var existing *models.Quiz
			if fromAirtableID, ok := existingByAirtableID[record.ID]; ok {
				existing = fromAirtableID
			} else if fromQuestion, ok := existingByQuestion[cleanQText]; ok {
				existing = fromQuestion
			}

			rawImageLinks := extractImageLinksFromFields(fields, imageFieldCandidates)
			var imageLinks []string
			if len(rawImageLinks) == 0 {
				imageLinks = nil
			} else if existing != nil && len(existing.ImageLink) == len(rawImageLinks) && allValidCDNUrls(existing.ImageLink) {
				// Reuse already-indexed Cloudinary CDN URLs from MongoDB without re-uploading
				imageLinks = existing.ImageLink
			} else {
				imageLinks = MirrorImagesToCloudinary(rawImageLinks)
			}

			var options []string
			if optionA != "" {
				options = append(options, optionA)
			}
			if optionB != "" {
				options = append(options, optionB)
			}
			if optionC != "" {
				options = append(options, optionC)
			}
			if optionD != "" {
				options = append(options, optionD)
			}
			log.Printf(
				"[Airtable Sync] record=%s question=%q level=%s subject=%s options=%d images=%d",
				record.ID,
				truncateForLog(questionText, 100),
				levelRaw,
				subject,
				len(options),
				len(imageLinks),
			)

			if subject == "" {
				subject = "General"
			}

			level := "intermediate" // default

			if levelRaw == "easy" || levelRaw == "basic" {
				level = "basic"
			} else if levelRaw == "hard" || levelRaw == "advanced" {
				level = "advanced"
			} else if levelRaw == "medium" || levelRaw == "intermediate" {
				level = "intermediate"
			}

			if testQuiz == "" {
				testQuiz = "Unknown"
			}
			earning := earningForLevel(level)

			upsertQuiz := &models.Quiz{
				TestQuiz:         testQuiz,
				TestLevel:        level,
				Subject:          subject,
				Earning:          earning,
				Question:         questionText,
				Options:          options,
				Answer:           correctAnswer,
				IsTypedAnswer:    false,
				ImageLink:        imageLinks,
				AirtableRecordID: record.ID,
			}

			if existing != nil {
				upsertQuiz.ID = existing.ID
				upsertQuiz.IDHex = existing.ID.Hex()
				if err := qs.UpdateQuiz(upsertQuiz); err != nil {
					log.Printf("Failed to update quiz from Airtable (record=%s): %v", record.ID, err)
					continue
				}
				log.Printf(
					"[Airtable Sync] action=updated record=%s mongoId=%s question=%q images=%d",
					record.ID,
					upsertQuiz.IDHex,
					truncateForLog(upsertQuiz.Question, 100),
					len(upsertQuiz.ImageLink),
				)
				updated++
				existingByAirtableID[record.ID] = upsertQuiz
				existingByQuestion[cleanQText] = upsertQuiz
			} else {
				upsertQuiz.ID = bson.NewObjectID()
				upsertQuiz.IDHex = upsertQuiz.ID.Hex()
				if err := qs.CreateQuiz(upsertQuiz); err != nil {
					log.Printf("Failed to insert quiz from Airtable (record=%s): %v", record.ID, err)
					continue
				}
				log.Printf(
					"[Airtable Sync] action=inserted record=%s mongoId=%s question=%q images=%d",
					record.ID,
					upsertQuiz.IDHex,
					truncateForLog(upsertQuiz.Question, 100),
					len(upsertQuiz.ImageLink),
				)
				inserted++
				existingByAirtableID[record.ID] = upsertQuiz
				existingByQuestion[cleanQText] = upsertQuiz
			}
		}

		offset = parsedRes.Offset
		if offset == "" {
			break
		}
	}

	log.Printf("Fetched %d total records from Airtable.", totalFetched)
	log.Printf("--- Airtable Sync Complete: %d inserted, %d updated ---", inserted, updated)
}

func PushToAirtable(quiz *models.Quiz, qs ...QuizService) {
	log.Printf("[Airtable Push] Pushing question %s to Airtable...", quiz.IDHex)

	rawBaseId := strings.TrimSpace(os.Getenv("AIRTABLE_BASE_ID"))
	apiKey := strings.TrimSpace(os.Getenv("AIRTABLE_API_KEY"))
	tableName := strings.TrimSpace(os.Getenv("AIRTABLE_TABLE_NAME"))

	if tableName == "" {
		tableName = "tbltD2dVLp7hNb60s"
	}

	if rawBaseId == "" || apiKey == "" {
		log.Println("[Airtable Push] AIRTABLE_BASE_ID or AIRTABLE_API_KEY missing, skipping push.")
		return
	}

	// 1. Ensure any non-Cloudinary images or videos are mirrored to Cloudinary
	if len(quiz.ImageLink) > 0 {
		quiz.ImageLink = MirrorImagesToCloudinary(quiz.ImageLink)
	}

	baseId := strings.Split(rawBaseId, "/")[0]
	tableName = strings.Split(tableName, "/")[0]

	airtableUrl := fmt.Sprintf("https://api.airtable.com/v0/%s/%s", baseId, url.PathEscape(tableName))

	// Map Go testLevel to Airtable Difficulty
	level := "Medium"
	if strings.EqualFold(quiz.TestLevel, "basic") || strings.EqualFold(quiz.TestLevel, "easy") {
		level = "Easy"
	} else if strings.EqualFold(quiz.TestLevel, "advanced") || strings.EqualFold(quiz.TestLevel, "hard") {
		level = "Hard"
	}

	fields := map[string]interface{}{
		"Question Text":               quiz.Question,
		"Correct Answer":              quiz.Answer,
		"Difficulty Level":            level,
		"Subject":                     quiz.Subject,
		"Educational Product/Purpose": quiz.TestQuiz,
	}

	if len(quiz.Options) > 0 {
		fields["Option A"] = quiz.Options[0]
	}
	if len(quiz.Options) > 1 {
		fields["Option B"] = quiz.Options[1]
	}
	if len(quiz.Options) > 2 {
		fields["Option C"] = quiz.Options[2]
	}
	if len(quiz.Options) > 3 {
		fields["Option D"] = quiz.Options[3]
	}

	imageFieldName := strings.TrimSpace(os.Getenv("AIRTABLE_IMAGE_FIELD"))
	if imageFieldName == "" {
		imageFieldName = "Image Link"
	}
	if len(quiz.ImageLink) > 0 {
		attachments := make([]map[string]string, 0, len(quiz.ImageLink))
		for _, imageURL := range quiz.ImageLink {
			trimmed := strings.TrimSpace(imageURL)
			if trimmed == "" {
				continue
			}
			attachments = append(attachments, map[string]string{"url": trimmed})
		}
		if len(attachments) > 0 {
			fields[imageFieldName] = attachments
		}
	}

	var req *http.Request
	var isUpdate bool
	if quiz.AirtableRecordID != "" {
		isUpdate = true
		updateUrl := fmt.Sprintf("%s/%s", airtableUrl, url.PathEscape(quiz.AirtableRecordID))
		payload := map[string]interface{}{"fields": fields}
		body, err := json.Marshal(payload)
		if err != nil {
			log.Println("[Airtable Push] Error marshalling Airtable update payload:", err)
			return
		}
		req, err = http.NewRequest("PATCH", updateUrl, bytes.NewReader(body))
		if err != nil {
			log.Println("[Airtable Push] Error creating Airtable update request:", err)
			return
		}
	} else {
		payload := AirtableCreateRequest{
			Records: []AirtableCreateRecord{
				{Fields: fields},
			},
		}
		body, marshalErr := json.Marshal(payload)
		if marshalErr != nil {
			log.Println("[Airtable Push] Error marshalling Airtable create payload:", marshalErr)
			return
		}
		var reqErr error
		req, reqErr = http.NewRequest("POST", airtableUrl, bytes.NewReader(body))
		if reqErr != nil {
			log.Println("[Airtable Push] Error creating Airtable create request:", reqErr)
			return
		}
	}

	req.Header.Add("Authorization", "Bearer "+apiKey)
	req.Header.Add("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		log.Println("[Airtable Push] Error pushing to Airtable:", err)
		return
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
		log.Printf("[Airtable Push] Airtable push failed with status: %d", res.StatusCode)
		var errRes map[string]interface{}
		json.NewDecoder(res.Body).Decode(&errRes)
		log.Printf("[Airtable Push] Airtable push error details: %+v", errRes)
		return
	}

	if !isUpdate {
		var parsedRes AirtableResponse
		if err := json.NewDecoder(res.Body).Decode(&parsedRes); err == nil && len(parsedRes.Records) > 0 {
			createdRecordID := parsedRes.Records[0].ID
			log.Printf("[Airtable Push] Created Airtable record %s for quiz %s", createdRecordID, quiz.IDHex)
			quiz.AirtableRecordID = createdRecordID
			if len(qs) > 0 && qs[0] != nil {
				if err := qs[0].UpdateQuiz(quiz); err != nil {
					log.Printf("[Airtable Push] Warning: failed to save airtableRecordId to mongo: %v", err)
				}
			}
		}
	} else {
		log.Printf("[Airtable Push] Successfully updated Airtable record %s for quiz %s", quiz.AirtableRecordID, quiz.IDHex)
	}

	log.Println("[Airtable Push] Successfully synced question to Airtable!")
}

func firstStringField(fields map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		value, ok := fields[key]
		if !ok {
			continue
		}
		if parsed := strings.TrimSpace(asString(value)); parsed != "" {
			return parsed
		}
	}
	return ""
}

func extractImageLinksFromFields(fields map[string]interface{}, preferredKeys []string) []string {
	candidates := make([]string, 0, len(preferredKeys)+2)
	candidates = append(candidates, preferredKeys...)
	for key := range fields {
		lower := strings.ToLower(strings.TrimSpace(key))
		if strings.Contains(lower, "image") || strings.Contains(lower, "photo") {
			candidates = append(candidates, key)
		}
	}

	seen := make(map[string]bool)
	links := make([]string, 0)
	for _, key := range candidates {
		value, ok := fields[key]
		if !ok {
			continue
		}
		appendImageCandidates(value, seen, &links)
	}

	return links
}

func appendImageCandidates(value interface{}, seen map[string]bool, links *[]string) {
	switch typed := value.(type) {
	case string:
		addImageCandidate(typed, seen, links)
	case []interface{}:
		for _, item := range typed {
			appendImageCandidates(item, seen, links)
		}
	case map[string]interface{}:
		if rawURL, ok := typed["url"]; ok {
			addImageCandidate(asString(rawURL), seen, links)
		}
	default:
		addImageCandidate(asString(value), seen, links)
	}
}

func addImageCandidate(candidate string, seen map[string]bool, links *[]string) {
	trimmed := strings.TrimSpace(strings.Trim(candidate, "\"'`"))
	if trimmed == "" {
		return
	}

	if strings.HasPrefix(trimmed, "[") {
		var parsed interface{}
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			appendImageCandidates(parsed, seen, links)
			return
		}
	}

	if strings.Contains(trimmed, ",") && !strings.HasPrefix(trimmed, "http") {
		parts := strings.Split(trimmed, ",")
		for _, part := range parts {
			addImageCandidate(part, seen, links)
		}
		return
	}

	if !(strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://")) {
		return
	}

	if seen[trimmed] {
		return
	}
	seen[trimmed] = true
	*links = append(*links, trimmed)
}

func asString(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func earningForLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "basic":
		return "400"
	case "advanced":
		return "800"
	default:
		return "600"
	}
}

func truncateForLog(value string, maxLen int) string {
	if maxLen <= 0 {
		return ""
	}
	trimmed := strings.TrimSpace(value)
	if len(trimmed) <= maxLen {
		return trimmed
	}
	return strings.TrimSpace(trimmed[:maxLen]) + "..."
}

func allValidCDNUrls(urls []string) bool {
	if len(urls) == 0 {
		return false
	}
	for _, u := range urls {
		trimmed := strings.TrimSpace(u)
		if trimmed == "" {
			return false
		}
		if !strings.HasPrefix(trimmed, "http://") && !strings.HasPrefix(trimmed, "https://") {
			return false
		}
		if !strings.Contains(trimmed, "res.cloudinary.com") && !strings.Contains(trimmed, "cloudinary.com") {
			return false
		}
	}
	return true
}

