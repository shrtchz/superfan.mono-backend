package models

import "time"

// User maps to Postgres "User" table (Prisma User).
type User struct {
	ID                 int        `gorm:"column:id;primaryKey" json:"id"`
	Email              string     `gorm:"column:email" json:"email"`
	SubscriptionPlan   *string    `gorm:"column:subscriptionPlan" json:"subscriptionPlan"`
	LanguagePreference *string    `gorm:"column:languagePreference" json:"languagePreference"`
	SubjectPreference  *string    `gorm:"column:subjectPreference" json:"subjectPreference"`
	TestLevel          *string    `gorm:"column:testLevel" json:"testLevel"`
	DailyStreak        int        `gorm:"column:dailyStreak" json:"dailyStreak"`
	LastStreakDate     *time.Time `gorm:"column:lastStreakDate" json:"lastStreakDate"`
	CreatedAt          time.Time  `gorm:"column:createdAt" json:"createdAt"`
}

func (User) TableName() string {
	return "User"
}
