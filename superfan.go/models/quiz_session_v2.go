package models

// CreateSessionV2Result is returned by POST /v2/quiz/sessions.
type CreateSessionV2Result struct {
	Session        SessionV2 `json:"session"`
	HasOngoingQuiz bool      `json:"hasOngoingQuiz"`
	Created        bool      `json:"created"`
}

// CreateSessionV2Request is the body for POST /v2/quiz/sessions.
type CreateSessionV2Request struct {
	UserID          int                   `json:"userId" binding:"required,min=1"`
	Mode            string                `json:"mode" binding:"omitempty,oneof=random custom"`
	Preferences     *SessionV2Preferences `json:"preferences"`
	ReplaceExisting bool                  `json:"replaceExisting"`
}

// SessionV2Preferences applies when mode is "custom".
type SessionV2Preferences struct {
	Language       string `json:"language"`
	Subject        string `json:"subject"`
	Level          string `json:"level"`
	QuestionCount  int    `json:"questionCount"`
	TimerMinutes   *int   `json:"timerMinutes"`
}

// BeginSessionV2Request is the body for PATCH /v2/quiz/sessions/:sessionId/begin.
type BeginSessionV2Request struct {
	UserID int `json:"userId" binding:"required,min=1"`
}

// SaveAnswerV2Request is the body for PATCH /v2/quiz/sessions/:sessionId/answers.
type SaveAnswerV2Request struct {
	UserID         int    `json:"userId" binding:"required,min=1"`
	QuestionID     string `json:"questionId" binding:"required"`
	SelectedAnswer string `json:"selectedAnswer" binding:"required"`
}

// SaveAnswerV2Result is returned after saving an answer.
type SaveAnswerV2Result struct {
	Answer  SavedAnswerV2Feedback `json:"answer"`
	Session SaveAnswerV2Session   `json:"session"`
}

type SavedAnswerV2Feedback struct {
	QuestionID           string `json:"questionId"`
	SelectedAnswer       string `json:"selectedAnswer"`
	IsCorrect            bool   `json:"isCorrect"`
	CorrectAnswer        string `json:"correctAnswer"`
	CorrectAnswerDisplay string `json:"correctAnswerDisplay"`
	Earning              int    `json:"earning"`
	AnsweredAt           string `json:"answeredAt"`
}

type SaveAnswerV2Session struct {
	ID             string `json:"id"`
	CurrentIndex   int    `json:"currentIndex"`
	AnswersCount   int    `json:"answersCount"`
	IsLastQuestion bool   `json:"isLastQuestion"`
	Status         string `json:"status"`
}

// FinalizeSessionV2Request is the body for submit and quit endpoints.
type FinalizeSessionV2Request struct {
	UserID          int    `json:"userId" binding:"required,min=1"`
	RewardType      string `json:"rewardType" binding:"required,oneof=cash points stablecoin"`
	QuizTimeSeconds int    `json:"quizTimeSeconds" binding:"required,min=0"`
	AdBonuses       int    `json:"adBonuses"`
}

// FinalizeSessionV2Result is returned by submit and quit.
type FinalizeSessionV2Result struct {
	Result     map[string]interface{}   `json:"result"`
	Responses  []map[string]interface{} `json:"responses"`
	Streak     map[string]interface{}   `json:"streak"`
	Session    SessionV2Summary         `json:"session"`
	Submitted  bool                     `json:"submitted"`
}

type SessionV2Summary struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// SessionV2 is the normalized quiz session returned by v2 endpoints.
type SessionV2 struct {
	ID               string              `json:"id"`
	UserID           int                 `json:"userId"`
	Mode             string              `json:"mode"`
	Status           string              `json:"status"`
	Questions        []SessionV2Question `json:"questions"`
	Answers          []SessionV2Answer   `json:"answers"`
	CurrentIndex     int                 `json:"currentIndex"`
	TotalQuestions   int                 `json:"totalQuestions"`
	TimeLimitSeconds *int                `json:"timeLimitSeconds"`
	StartedAt        *string             `json:"startedAt"`
	ExpiresAt        *string             `json:"expiresAt"`
	CreatedAt        string              `json:"createdAt"`
}

// SessionV2Question is the client-facing question shape.
type SessionV2Question struct {
	ID            string   `json:"id"`
	Text          string   `json:"text"`
	Options       []string `json:"options"`
	Level         string   `json:"level"`
	Subject       string   `json:"subject"`
	Language      string   `json:"language"`
	Earning       int      `json:"earning"`
	Images        []string `json:"images"`
	Videos        []string `json:"videos"`
	InputRequired bool     `json:"inputRequired"`
}

// SessionV2Answer is a saved answer on the session.
type SessionV2Answer struct {
	QuestionID     string `json:"questionId"`
	SelectedAnswer string `json:"selectedAnswer"`
	IsCorrect      bool   `json:"isCorrect"`
	AnsweredAt     string `json:"answeredAt"`
}
