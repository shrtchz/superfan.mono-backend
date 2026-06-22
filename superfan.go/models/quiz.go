package models

import (
	"encoding/json"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type StringOrSlice []string

func (s *StringOrSlice) UnmarshalJSON(data []byte) error {
	// Try array first
	var arr []string
	if err := json.Unmarshal(data, &arr); err == nil {
		*s = arr
		return nil
	}

	// Fall back to single string
	var str string
	if err := json.Unmarshal(data, &str); err != nil {
		return err
	}
	*s = []string{str}
	return nil
}

type Quiz struct {
	ID    bson.ObjectID `bson:"_id" json:"-"`
	IDHex string        `bson:"-" json:"id"`

	TestQuiz  string `json:"testQuiz" bson:"testQuiz"`
	TestLevel string `json:"testLevel" bson:"testLevel"`
	Subject   string `json:"subject" bson:"subject"`

	Earning       string   `json:"earning" bson:"earning"`
	Question      string   `json:"question" bson:"question"`
	Options       []string `json:"options" bson:"options"`
	Answer        string   `json:"answer" bson:"answer"`
	IsTypedAnswer bool     `json:"isTypedAnswer" bson:"isTypedAnswer"`
	TypedAnswer   string   `json:"typedAnswer,omitempty" bson:"typedAnswer,omitempty"`
	ImageLink     []string `json:"imageLink,omitempty" bson:"imageLink,omitempty"`
}

type LiveQuiz struct {
	ID               bson.ObjectID `bson:"_id" json:"-"`
	IDHex            string        `bson:"-" json:"id"`
	Question         string        `json:"question" bson:"question"`
	Options          []string      `json:"options" bson:"options"`
	Answer           string        `bson:"answer,omitempty" json:"answer,omitempty"`
	IsTypedAnswer    bool          `json:"isTypedAnswer,omitempty" bson:"isTypedAnswer,omitempty"`
	TypedAnswer      string        `json:"typedAnswer,omitempty" bson:"typedAnswer,omitempty"`
	TotalPrize       int           `json:"totalPrize" bson:"totalPrize"`
	Recipients       int           `json:"recipients" bson:"recipients"`
	UnitPrize        int           `json:"unitPrize" bson:"unitPrize"`
	ShowAnswer       bool          `json:"showAnswer" bson:"showAnswer"`
	QuizScheduleDate time.Time     `json:"quizScheduleDate" bson:"quizScheduleDate"`
	ImageLink        []string `json:"imageLink,omitempty" bson:"imageLink,omitempty"`
}

type QuizAnswer struct {
	QuizID         bson.ObjectID `json:"quizId" bson:"quizId"`
	SelectedAnswer string        `json:"selectedAnswer" bson:"selectedAnswer"`
	Subject        string        `json:"subject" bson:"subject"`
	IsCorrect      bool          `json:"isCorrect" bson:"isCorrect"`
	CorrectAnswer  string        `json:"correctAnswer" bson:"correctAnswer"`
	Earning        int           `json:"earning" bson:"earning"`
}

type QuizSubmission struct {
	ID            bson.ObjectID `json:"id,omitempty" bson:"_id,omitempty"`
	UserID        string        `json:"userId" bson:"userId"`
	Score         int           `json:"score" bson:"score"`
	Subject       string        `bson:"subject" json:"subject"`
	TotalAnswered int           `json:"totalAnswered" bson:"totalAnswered"`
	TotalEarning  int           `json:"totalEarning" bson:"totalEarning"`
	RewardType    string        `json:"rewardType" bson:"rewardType"`
	QuizTime      string        `json:"quizTime" bson:"quizTime"`
	Responses     []QuizAnswer  `json:"responses" bson:"responses"`
	SubmittedAt   time.Time     `json:"submittedAt" bson:"submittedAt"`
}

type QuizAnswerRequest struct {
	QuizID         string `json:"quizId"`
	SelectedAnswer string `json:"selectedAnswer"`
	QuizTime       string `json:"quizTime" bson:"quizTime"`
	RewardType     string `json:"rewardType" bson:"rewardType"`
}

type SubmitQuizRequest struct {
	UserID     string              `json:"userId"`
	QuizTime   string              `json:"quizTime" bson:"quizTime"`
	RewardType string              `json:"rewardType" bson:"rewardType"`
	Responses  []QuizAnswerRequest `json:"responses"`
}


type QuizCategory struct {
    ID bson.ObjectID `bson:"_id" json:"id"`

    TestQuiz string `json:"testQuiz" bson:"testQuiz"`
    Subject  string `json:"subject" bson:"subject"`
}

func (qc *QuizCategory) ToQuiz() *Quiz {
    return &Quiz{
        ID:       qc.ID,
        IDHex:    qc.ID.Hex(),
        TestQuiz: qc.TestQuiz,
        Subject:  qc.Subject,
    }
}

// Mirrors the flat DB document — used only for decoding
type QuizSubmissionDoc struct {
	ID             bson.ObjectID `bson:"_id,omitempty"`
	UserID         string        `bson:"userId"`
	QuizID         bson.ObjectID `bson:"quizId"`
	SelectedAnswer string        `bson:"selectedAnswer"`
	IsCorrect      bool          `bson:"isCorrect"`
	CorrectAnswer  string        `bson:"correctAnswer"`
	Earning        int           `bson:"earning"`
	SubmittedAt    time.Time     `bson:"submittedAt"`
}

func ToSubmissionDTO(doc QuizSubmissionDoc) QuizSubmission {
	score := 0
	if doc.IsCorrect {
		score = 1
	}
	return QuizSubmission{
		ID:            doc.ID,
		UserID:        doc.UserID,
		Score:         score,
		TotalAnswered: 1,
		TotalEarning:  doc.Earning,
		Responses: []QuizAnswer{
			{
				QuizID:         doc.QuizID,
				SelectedAnswer: doc.SelectedAnswer,
				IsCorrect:      doc.IsCorrect,
				CorrectAnswer:  doc.CorrectAnswer,
				Earning:        doc.Earning,
			},
		},
		SubmittedAt: doc.SubmittedAt,
	}
}
