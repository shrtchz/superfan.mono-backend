package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	"quiz.superfan.com/apis/models"
)

type AirtableRecord struct {
	ID     string `json:"id"`
	Fields struct {
		QuestionText  string `json:"Question Text"`
		OptionA       string `json:"Option A"`
		OptionB       string `json:"Option B"`
		OptionC       string `json:"Option C"`
		OptionD       string `json:"Option D"`
		CorrectAnswer string `json:"Correct Answer"`
		Subject            string `json:"Subject"`
		Difficulty         string `json:"Difficulty Level"`
		EducationalProduct string `json:"Educational Product/Purpose"`
	} `json:"fields"`
}

type AirtableResponse struct {
	Records []AirtableRecord `json:"records"`
	Offset  string           `json:"offset,omitempty"`
	Error   interface{}      `json:"error,omitempty"`
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

	// Get existing quizzes to avoid duplicates
	existingQuizzes, err := qs.GetAllQuiz()
	if err != nil {
		log.Println("Failed to fetch existing quizzes from DB:", err)
		return
	}

	existingMap := make(map[string]bool)
	for _, q := range existingQuizzes {
		cleanQ := strings.TrimSpace(strings.ToLower(q.Question))
		existingMap[cleanQ] = true
	}

	inserted := 0
	skipped := 0
	offset := ""
	totalFetched := 0

	for {
		fetchUrl := airtableUrl
		if offset != "" {
			fetchUrl = fmt.Sprintf("%s?offset=%s", airtableUrl, url.QueryEscape(offset))
		}

		req, err := http.NewRequest("GET", fetchUrl, nil)
		if err != nil {
			log.Println("Error creating Airtable request:", err)
			return
		}

		req.Header.Add("Authorization", "Bearer "+apiKey)
		req.Header.Add("Content-Type", "application/json")

		client := &http.Client{}
		res, err := client.Do(req)
		if err != nil {
			log.Println("Error making Airtable request:", err)
			return
		}

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
			if fields.QuestionText == "" {
				continue
			}

			cleanQText := strings.TrimSpace(strings.ToLower(fields.QuestionText))
			if existingMap[cleanQText] {
				skipped++
				continue
			}

			var options []string
			if fields.OptionA != "" { options = append(options, fields.OptionA) }
			if fields.OptionB != "" { options = append(options, fields.OptionB) }
			if fields.OptionC != "" { options = append(options, fields.OptionC) }
			if fields.OptionD != "" { options = append(options, fields.OptionD) }

			subject := fields.Subject
			if subject == "" {
				subject = "General"
			}

			levelRaw := strings.ToLower(strings.TrimSpace(fields.Difficulty))
			level := "intermediate" // default

			if levelRaw == "easy" || levelRaw == "basic" {
				level = "basic"
			} else if levelRaw == "hard" || levelRaw == "advanced" {
				level = "advanced"
			} else if levelRaw == "medium" || levelRaw == "intermediate" {
				level = "intermediate"
			}

			testQuiz := fields.EducationalProduct
			if testQuiz == "" {
				testQuiz = "Unknown"
			}

			quiz := &models.Quiz{
				ID:            bson.NewObjectID(),
				TestQuiz:      testQuiz,
				TestLevel:     level,
				Subject:       subject,
				Earning:       "0",
				Question:      fields.QuestionText,
				Options:       options,
				Answer:        fields.CorrectAnswer,
				IsTypedAnswer: false,
			}
			quiz.IDHex = quiz.ID.Hex()

			if err := qs.CreateQuiz(quiz); err != nil {
				log.Println("Failed to insert quiz from Airtable:", err)
			} else {
				inserted++
				existingMap[cleanQText] = true
			}
		}

		offset = parsedRes.Offset
		if offset == "" {
			break
		}
	}

	log.Printf("Fetched %d total records from Airtable.", totalFetched)
	log.Printf("--- Airtable Sync Complete: %d inserted, %d duplicates skipped ---", inserted, skipped)
}
