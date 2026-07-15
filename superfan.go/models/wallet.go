package models

import "time"

type Wallet struct {
	ID          int     `gorm:"column:id;primaryKey" json:"id"`
	UserID      int     `gorm:"column:userId;uniqueIndex" json:"userId"`
	Balance     float64 `gorm:"column:balance" json:"balance"`
	UsdcBalance float64 `gorm:"column:usdcBalance" json:"usdcBalance"`
	UsdtBalance float64 `gorm:"column:usdtBalance" json:"usdtBalance"`
}

func (Wallet) TableName() string {
	return "Wallet"
}

type WalletTransaction struct {
	ID          int       `gorm:"column:id;primaryKey" json:"id"`
	UserID      int       `gorm:"column:userId" json:"userId"`
	Amount      float64   `gorm:"column:amount" json:"amount"`
	Type        *string   `gorm:"column:type" json:"type"`
	Description *string   `gorm:"column:description" json:"description"`
	TrxRef      *string   `gorm:"column:trx_ref" json:"trx_ref"`
	CreatedAt   time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (WalletTransaction) TableName() string {
	return "WalletTransaction"
}

type Reward struct {
	ID        string    `gorm:"column:id;primaryKey" json:"id"`
	UserID    int       `gorm:"column:userId" json:"userId"`
	Amount    int       `gorm:"column:amount" json:"amount"`
	Currency  string    `gorm:"column:currency" json:"currency"`
	Type      string    `gorm:"column:type" json:"type"`
	Status    string    `gorm:"column:status" json:"status"`
	CreatedAt time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (Reward) TableName() string {
	return "Reward"
}

type Point struct {
	ID        string    `gorm:"column:id;primaryKey" json:"id"`
	UserID    int       `gorm:"column:userId" json:"userId"`
	Points    int       `gorm:"column:points" json:"points"`
	Reference *string   `gorm:"column:reference" json:"reference"`
	Type      string    `gorm:"column:type" json:"type"`
	CreatedAt time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (Point) TableName() string {
	return "Point"
}

type QuizLeaderboard struct {
	ID             int       `gorm:"column:id;primaryKey" json:"id"`
	UserID         string    `gorm:"column:userId" json:"userId"`
	QuizID         string    `gorm:"column:quizId" json:"quizId"`
	Subject        string    `gorm:"column:subject" json:"subject"`
	TestLevel      string    `gorm:"column:testLevel" json:"testLevel"`
	Score          *int      `gorm:"column:score" json:"score"`
	SelectedAnswer string    `gorm:"column:selectedAnswer" json:"selectedAnswer"`
	QuizTime       *string   `gorm:"column:quizTime" json:"quizTime"`
	AccuracyBonus  *string   `gorm:"column:accuracyBonus" json:"accuracyBonus"`
	CorrectAnswer  string    `gorm:"column:correctAnswer" json:"correctAnswer"`
	Earning        int       `gorm:"column:earning" json:"earning"`
	SubmittedAt    time.Time `gorm:"column:submittedAt" json:"submittedAt"`
	CreatedAt      time.Time `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt      time.Time `gorm:"column:updatedAt" json:"updatedAt"`
}

func (QuizLeaderboard) TableName() string {
	return "QuizLeaderboard"
}
