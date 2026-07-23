package models

import (
	"encoding/json"
	"time"
)

// OngoingQuiz maps to Postgres table "ongoing_quizzes" (Prisma OngoingQuiz).
type OngoingQuiz struct {
	ID                  string          `gorm:"column:id;primaryKey" json:"id"`
	UserID              int             `gorm:"column:userId" json:"userId"`
	TestQuiz            string          `gorm:"column:testQuiz" json:"testQuiz"`
	Subject             string          `gorm:"column:subject" json:"subject"`
	TestLevel           string          `gorm:"column:testLevel" json:"testLevel"`
	TotalEarning        int             `gorm:"column:totalEarning" json:"totalEarning"`
	TotalEarninginUSDC  *int            `gorm:"column:totalEarninginUSDC" json:"totalEarninginUSDC"`
	TotalEarninginUSDT  *int            `gorm:"column:totalEarninginUSDT" json:"totalEarninginUSDT"`
	TotalEarninginNaira *int            `gorm:"column:totalEarninginNaira" json:"totalEarninginNaira"`
	TotalQuestions      int             `gorm:"column:totalQuestions" json:"totalQuestions"`
	TotalTime           *int            `gorm:"column:totalTime" json:"totalTime"`
	BaseScore           *int            `gorm:"column:baseScore" json:"baseScore"`
	IsRandom            bool            `gorm:"column:isRandom" json:"isRandom"`
	AccuracyBonus       *int            `gorm:"column:accuracyBonus" json:"accuracyBonus"`
	SpeedBonus          *int            `gorm:"column:speedBonus" json:"speedBonus"`
	StreakMultiplier    *int            `gorm:"column:streakMultiplier" json:"streakMultiplier"`
	AdBonuses           *int            `gorm:"column:adBonuses" json:"adBonuses"`
	QuizTime            *string         `gorm:"column:quizTime" json:"quizTime"`
	TimeRemaining       int             `gorm:"column:timeRemaining" json:"timeRemaining"`
	Questions           json.RawMessage `gorm:"column:questions;type:jsonb" json:"questions"`
	Answers             json.RawMessage `gorm:"column:answers;type:jsonb" json:"answers"`
	CurrentIndex        int             `gorm:"column:currentIndex" json:"currentIndex"`
	EarnedAmount        int             `gorm:"column:earnedAmount" json:"earnedAmount"`
	IsCompleted         bool            `gorm:"column:isCompleted" json:"isCompleted"`
	StartedAt           *time.Time      `gorm:"column:startedAt" json:"startedAt"`
	ExpiresAt           *time.Time      `gorm:"column:expiresAt" json:"expiresAt"`
	CompletedAt         *time.Time      `gorm:"column:completedAt" json:"completedAt"`
	CreatedAt           time.Time       `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt           time.Time       `gorm:"column:updatedAt" json:"updatedAt"`
	QuizAttempt         *QuizAttempt    `gorm:"foreignKey:QuizID;references:ID" json:"quizAttempt,omitempty"`
}

func (OngoingQuiz) TableName() string {
	return "ongoing_quizzes"
}

// QuizAttempt maps to Postgres table "QuizAttempt" (Prisma QuizAttempt).
type QuizAttempt struct {
	ID          int        `gorm:"column:id;primaryKey" json:"id"`
	UserID      int        `gorm:"column:userId" json:"userId"`
	QuizID      string     `gorm:"column:quizId" json:"quizId"`
	StartedAt   *time.Time `gorm:"column:startedAt" json:"startedAt"`
	ExpiresAt   *time.Time `gorm:"column:expiresAt" json:"expiresAt"`
	CompletedAt *time.Time `gorm:"column:completedAt" json:"completedAt"`
	IsStarted   bool       `gorm:"column:isStarted" json:"isStarted"`
	IsCompleted bool       `gorm:"column:isCompleted" json:"isCompleted"`
}

func (QuizAttempt) TableName() string {
	return "QuizAttempt"
}
